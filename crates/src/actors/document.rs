// src/document.rs
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicI64, AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

use tokio::{
    io::AsyncWriteExt,
    sync::{Mutex as AsyncMutex, RwLock, broadcast},
    task::JoinHandle,
};
use tracing::{debug, info, warn};
use yrs::ClientID;
use yrs::sync::AwarenessUpdate;
use yrs::sync::awareness::AwarenessUpdateEntry;
use yrs::{
    GetString, ReadTxn, StateVector, Text, Transact, Update,
    updates::{decoder::Decode, encoder::Encode},
};

use crate::{
    actors::LspServerActor,
    models::{ClientId, DocEvent, FileId, LspDiagnostic, PersistencePhase, WorkspaceId},
    state::AppState,
    util::{byte_offset_to_position, diff},
};
use yrs::WriteTxn;

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> i64 {
    // wall-clock, not Instant — Instant is relative to an arbitrary
    // process-start point and isn't meaningful for idle-time logging
    // across restarts.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct DocumentActor {
    location: RwLock<DocumentLocation>,
    workspace_id: WorkspaceId,
    file_id: RwLock<FileId>,
    doc: RwLock<yrs::Doc>,
    updates_tx: broadcast::Sender<DocEvent>,
    awareness: AsyncMutex<HashMap<ClientID, AwarenessRecord>>,
    editable: AtomicBool,
    deleted: AtomicBool,
    subscribers: AtomicUsize,
    last_activity: AtomicI64,
    lsp_opened: AtomicBool,
    lsp_version: AtomicI64,
    diagnostics: RwLock<Vec<LspDiagnostic>>,
    revision: AtomicU64,
    persisted_revision: AtomicU64,
    state_lock: AsyncMutex<()>,
    save_lock: Arc<AsyncMutex<()>>,
    saving: AtomicBool,
    save_error: RwLock<Option<String>>,
    last_synced_text: RwLock<String>,
    debounce_task: AsyncMutex<Option<JoinHandle<()>>>,
    eviction_task: AsyncMutex<Option<JoinHandle<()>>>,
}

#[derive(Debug, Clone)]
struct DocumentLocation {
    path: PathBuf,
    epoch: u64,
}

#[derive(Clone)]
struct AwarenessRecord {
    owner_client: ClientId,
    owner_connection: u64,
    entry: AwarenessUpdateEntry,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentLifecycle {
    pub revision: u64,
    pub persisted_revision: u64,
    pub phase: PersistencePhase,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaveResult {
    pub saved_revision: u64,
    pub current_revision: u64,
}

impl std::fmt::Debug for DocumentActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DocumentActor")
            .field("workspace_id", &self.workspace_id)
            .field("file_id", &self.file_id)
            .field("subscribers", &self.subscribers)
            .finish()
    }
}

impl DocumentActor {
    pub async fn load(
        workspace_id: &WorkspaceId,
        file_id: &FileId,
        path: PathBuf,
    ) -> anyhow::Result<Arc<Self>> {
        let content = tokio::fs::read_to_string(&path).await?;
        debug!(
            workspace_id = %workspace_id,
            file_id = %file_id,
            path = ?path,
            revision = 0_u64,
            persisted_revision = 0_u64,
            "document loaded"
        );
        let doc = yrs::Doc::new();
        {
            let mut txn = doc.transact_mut();
            let text = txn.get_or_insert_text("content");
            text.push(&mut txn, &content);
        }

        Ok(Arc::new(Self {
            location: RwLock::new(DocumentLocation { path, epoch: 0 }),
            workspace_id: workspace_id.clone(),
            file_id: RwLock::new(file_id.clone()),
            doc: RwLock::new(doc),
            updates_tx: broadcast::channel(256).0,
            awareness: AsyncMutex::new(HashMap::new()),
            editable: AtomicBool::new(true),
            deleted: AtomicBool::new(false),
            subscribers: AtomicUsize::new(0),
            last_activity: AtomicI64::new(now_ms()),
            lsp_opened: AtomicBool::new(false),
            lsp_version: AtomicI64::new(0),
            diagnostics: RwLock::new(Vec::new()),
            revision: AtomicU64::new(0),
            persisted_revision: AtomicU64::new(0),
            state_lock: AsyncMutex::new(()),
            save_lock: Arc::new(AsyncMutex::new(())),
            saving: AtomicBool::new(false),
            save_error: RwLock::new(None),
            last_synced_text: RwLock::new(content),
            debounce_task: AsyncMutex::new(None),
            eviction_task: AsyncMutex::new(None),
        }))
    }

    pub async fn path_matches(&self, path: &str) -> bool {
        self.location.read().await.path == Path::new(path)
    }

    /// Return the current path and its monotonic location epoch. Saves use
    /// both values so a later rename can invalidate an older snapshot.
    pub async fn location(&self) -> (PathBuf, u64) {
        let location = self.location.read().await;
        (location.path.clone(), location.epoch)
    }

    pub async fn file_id(&self) -> FileId {
        self.file_id.read().await.clone()
    }

    /// Acquire the document mutation lock. Filesystem coordination holds this
    /// lock across the disk rename/delete and registry commit so a save cannot
    /// race a path mutation.
    pub async fn acquire_save_lock(&self) -> tokio::sync::OwnedMutexGuard<()> {
        self.save_lock.clone().lock_owned().await
    }

    /// Update both path indexes after the coordinator has committed the disk
    /// operation while holding the save lock returned above.
    pub async fn relocate_after_commit(&self, file_id: FileId, path: PathBuf) {
        let mut location = self.location.write().await;
        location.path = path;
        location.epoch = location.epoch.wrapping_add(1);
        *self.file_id.write().await = file_id;
    }

    /// Mark deleted while the caller owns the save lock.
    pub async fn mark_deleted_locked(&self) {
        self.editable.store(false, Ordering::Release);
        self.deleted.store(true, Ordering::Release);
        if let Some(task) = self.debounce_task.lock().await.take() {
            task.abort();
        }
        self.broadcast_lifecycle().await;
    }

    /// Change the disk location only after any in-flight save has completed.
    /// The epoch makes a path change observable to save callers even when the
    /// destination happens to have the same contents.
    pub async fn update_location(&self, path: PathBuf) -> anyhow::Result<u64> {
        let _save_guard = self.save_lock.lock().await;
        if self.deleted.load(Ordering::Acquire) {
            anyhow::bail!("document is deleted");
        }
        let mut location = self.location.write().await;
        location.path = path;
        location.epoch = location.epoch.wrapping_add(1);
        Ok(location.epoch)
    }

    pub fn is_dirty(&self) -> bool {
        self.revision.load(Ordering::Acquire) != self.persisted_revision.load(Ordering::Acquire)
    }

    pub async fn lifecycle_snapshot(&self) -> DocumentLifecycle {
        let revision = self.revision.load(Ordering::Acquire);
        let persisted_revision = self.persisted_revision.load(Ordering::Acquire);
        let error = self.save_error.read().await.clone();
        let phase = if self.deleted.load(Ordering::Acquire) {
            PersistencePhase::Deleted
        } else if self.saving.load(Ordering::Acquire) {
            PersistencePhase::Saving
        } else if error.is_some() && revision != persisted_revision {
            PersistencePhase::SaveError
        } else if revision != persisted_revision {
            PersistencePhase::Pending
        } else {
            PersistencePhase::Clean
        };
        DocumentLifecycle {
            revision,
            persisted_revision,
            phase,
            error,
        }
    }

    async fn broadcast_lifecycle(&self) {
        let state = self.lifecycle_snapshot().await;
        let _ = self.updates_tx.send(DocEvent::State {
            revision: state.revision,
            persisted_revision: state.persisted_revision,
            phase: state.phase,
            error: state.error,
        });
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<DocEvent> {
        self.updates_tx.subscribe()
    }

    /// Call when a client subscribes. Bumps refcount and cancels any
    /// pending eviction — e.g. a tab refresh that reconnected inside the
    /// debounce window shouldn't lose the in-memory doc.
    pub async fn subscribe(&self) {
        let (path, _) = self.location().await;
        debug!("Client has subscribed to the document {:?}", path);
        self.subscribers.fetch_add(1, Ordering::AcqRel);
        self.last_activity.store(now_ms(), Ordering::Relaxed);
        if let Some(task) = self.eviction_task.lock().await.take() {
            task.abort();
        }
    }

    /// Call when a client unsubscribes. If this was the last one, schedule
    /// a debounced flush+evict. `on_evict` is the caller's chance to remove
    /// this actor from AppState.open_files — kept as a callback so this
    /// module doesn't need to know about AppState.
    pub async fn unsubscribe(self: &Arc<Self>, state: AppState, key: (WorkspaceId, FileId)) {
        let remaining = loop {
            let current = self.subscribers.load(Ordering::Acquire);
            if current == 0 {
                // A duplicate/unordered unsubscribe must not underflow the
                // refcount and schedule eviction for an active document.
                return;
            }
            if let Ok(previous) = self.subscribers.compare_exchange(
                current,
                current - 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                break previous - 1;
            }
        };
        self.last_activity.store(now_ms(), Ordering::Relaxed);
        if remaining > 0 {
            return;
        }

        let this = self.clone();
        let workspace_id = key.0.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if this.subscribers.load(Ordering::Acquire) != 0 {
                return; // someone resubscribed during the debounce window
            }
            if this.is_dirty() {
                if let Err(e) = this.save().await {
                    let (path, _) = this.location().await;
                    warn!("failed to flush {:?} before eviction: {e}", path);
                    return; // don't evict data we failed to persist
                }
            }
            let (path, _) = this.location().await;
            info!("evicting idle document {:?}", path);
            // A filesystem rename may have re-keyed the actor while this
            // debounce task was sleeping. Resolve the current key instead of
            // removing the stale pre-rename key captured by unsubscribe.
            let current_key = (workspace_id, this.file_id().await);
            state.open_files.remove(&current_key);
        });

        *self.eviction_task.lock().await = Some(handle);
    }

    pub async fn apply_remote_update(
        self: &Arc<Self>,
        update: &[u8],
        origin: ClientId,
    ) -> anyhow::Result<u64> {
        if !self.editable.load(Ordering::Acquire) {
            anyhow::bail!("document is read-only");
        }

        // A client with no missing state may send an empty delta. It is a
        // valid synchronization result, not a malformed edit or revision.
        if update.is_empty() {
            return Ok(self.generation());
        }

        let decoded = Update::decode_v1(update)?;

        let generation = {
            let _state_guard = self.state_lock.lock().await;
            let doc = self.doc.read().await;
            let mut txn = doc.transact_mut();
            let before = txn
                .get_text("content")
                .map(|text| text.get_string(&txn))
                .unwrap_or_default();
            txn.apply_update(decoded)?;
            let after = txn
                .get_text("content")
                .map(|text| text.get_string(&txn))
                .unwrap_or_default();
            if before == after {
                None
            } else {
                // Keep the revision paired with the applied Yrs state. A
                // concurrent save cannot snapshot new content while still
                // observing the old revision.
                let generation = self.revision.fetch_add(1, Ordering::AcqRel) + 1;
                self.last_activity.store(now_ms(), Ordering::Relaxed);
                Some(generation)
            }
        };

        // Yjs/Yrs updates are idempotent. A reconnect may legitimately
        // replay an update that the actor already contains; it must not make
        // the document look dirty or advance its revision a second time.
        let Some(generation) = generation else {
            return Ok(self.generation());
        };

        *self.save_error.write().await = None;

        let _ = self.updates_tx.send(DocEvent::Update {
            update: update.to_vec(),
            origin,
        });
        self.broadcast_lifecycle().await;
        self.schedule_autosave(generation).await;
        Ok(generation)
    }

    pub fn generation(&self) -> u64 {
        self.revision.load(Ordering::Acquire)
    }

    async fn schedule_autosave(self: &Arc<Self>, generation: u64) {
        let mut slot = self.debounce_task.lock().await;
        if let Some(task) = slot.take() {
            task.abort();
        }

        let this = self.clone();
        *slot = Some(tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            if this.revision.load(Ordering::Acquire) != generation || !this.is_dirty() {
                return;
            }
            // Keep the debounce timer cancellable without allowing a later
            // keystroke to interrupt an atomic save already in progress.
            tokio::spawn(async move {
                if let Err(error) = this.save().await {
                    let (path, _) = this.location().await;
                    warn!("autosave failed for {:?}: {error}", path);
                }
            });
        }));
    }

    /// Mark a document deleted/read-only. The save mutex ensures that a save
    /// cannot commit after deletion has been acknowledged by this actor.
    pub async fn mark_deleted(&self) {
        let _save_guard = self.save_lock.lock().await;
        self.mark_deleted_locked().await;
    }

    /// Serialize all disk writes for this document. The snapshot is paired
    /// with the revision while holding state_lock; edits during the awaited
    /// filesystem operation therefore remain dirty for a later save.
    pub async fn save(&self) -> anyhow::Result<SaveResult> {
        let _save_guard = self.save_lock.lock().await;
        if self.deleted.load(Ordering::Acquire) {
            anyhow::bail!("document is deleted");
        }
        if !self.editable.load(Ordering::Acquire) {
            anyhow::bail!("document is read-only");
        }

        let (content, target_revision, persisted_revision, location) = {
            let _state_guard = self.state_lock.lock().await;
            let content = self.content_snapshot().await;
            let target_revision = self.revision.load(Ordering::Acquire);
            let persisted_revision = self.persisted_revision.load(Ordering::Acquire);
            let location = self.location.read().await.clone();
            (content, target_revision, persisted_revision, location)
        };

        if target_revision == persisted_revision {
            return Ok(SaveResult {
                saved_revision: target_revision,
                current_revision: target_revision,
            });
        }

        // The save lock prevents a concurrent filesystem rename from changing
        // this identity until the snapshot has finished writing.
        let file_id = self.file_id().await;

        self.saving.store(true, Ordering::Release);
        *self.save_error.write().await = None;
        self.broadcast_lifecycle().await;

        debug!(
            workspace_id = %self.workspace_id,
            file_id = %file_id,
            path = ?location.path,
            revision = target_revision,
            persisted_revision,
            "document save started"
        );

        let result = self.write_snapshot(&location, &content).await;
        match result {
            Ok(()) => {
                self.persisted_revision
                    .store(target_revision, Ordering::Release);
                self.saving.store(false, Ordering::Release);
                let current_revision = self.revision.load(Ordering::Acquire);
                let result = SaveResult {
                    saved_revision: target_revision,
                    current_revision,
                };
                info!(
                    workspace_id = %self.workspace_id,
                    file_id = %file_id,
                    path = ?location.path,
                    saved_revision = target_revision,
                    current_revision,
                    persisted_revision = target_revision,
                    "document save completed"
                );
                self.broadcast_lifecycle().await;
                Ok(result)
            }
            Err(error) => {
                self.saving.store(false, Ordering::Release);
                *self.save_error.write().await = Some(error.to_string());
                warn!(
                    workspace_id = %self.workspace_id,
                    file_id = %file_id,
                    path = ?location.path,
                    revision = target_revision,
                    persisted_revision,
                    error = %error,
                    "document save failed"
                );
                self.broadcast_lifecycle().await;
                Err(error)
            }
        }
    }

    async fn write_snapshot(
        &self,
        location: &DocumentLocation,
        content: &str,
    ) -> anyhow::Result<()> {
        let original_permissions = match tokio::fs::metadata(&location.path).await {
            Ok(metadata) => Some(metadata.permissions()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let parent = location
            .path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("document path has no parent"))?;
        let name = location
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| anyhow::anyhow!("document path has no valid filename"))?;
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(
            ".{name}.forge-save-{}-{counter}",
            std::process::id()
        ));

        let write_result = async {
            let mut file = tokio::fs::File::create(&temp_path).await?;
            file.write_all(content.as_bytes()).await?;
            if let Some(permissions) = original_permissions {
                tokio::fs::set_permissions(&temp_path, permissions).await?;
            }
            file.sync_all().await?;
            tokio::fs::rename(&temp_path, &location.path).await?;
            anyhow::Result::<()>::Ok(())
        }
        .await;

        if write_result.is_err() {
            let _ = tokio::fs::remove_file(&temp_path).await;
        }
        write_result
    }

    /// Validate protocol framing and bind awareness client IDs to the socket
    /// that first advertised them. Application JSON remains opaque.
    pub async fn apply_awareness(
        &self,
        payload: Vec<u8>,
        origin: ClientId,
        connection_id: u64,
    ) -> anyhow::Result<()> {
        anyhow::ensure!(payload.len() <= 64 * 1024, "awareness payload is too large");
        let update = AwarenessUpdate::decode_v1(&payload)?;
        anyhow::ensure!(
            update.clients.len() <= 32,
            "too many awareness clients in one update"
        );
        let mut awareness = self.awareness.lock().await;
        for (awareness_id, next) in &update.clients {
            if let Some(current) = awareness.get(awareness_id) {
                anyhow::ensure!(
                    current.owner_client == origin && current.owner_connection == connection_id,
                    "awareness client ID is owned by another connection"
                );
                if next.clock < current.entry.clock {
                    continue;
                }
            }
            awareness.insert(
                *awareness_id,
                AwarenessRecord {
                    owner_client: origin.clone(),
                    owner_connection: connection_id,
                    entry: next.clone(),
                },
            );
        }
        drop(awareness);
        let _ = self
            .updates_tx
            .send(DocEvent::AwarenessUpdate { payload, origin });
        Ok(())
    }

    pub async fn awareness_snapshot(&self) -> Vec<u8> {
        let awareness = self.awareness.lock().await;
        AwarenessUpdate {
            clients: awareness
                .iter()
                .filter(|(_, record)| record.entry.json.as_ref() != "null")
                .map(|(id, record)| (*id, record.entry.clone()))
                .collect(),
        }
        .encode_v1()
    }

    pub async fn remove_awareness_owner(&self, owner_client: &ClientId, owner_connection: u64) {
        let mut awareness = self.awareness.lock().await;
        let owned: Vec<_> = awareness
            .iter()
            .filter(|(_, record)| {
                &record.owner_client == owner_client && record.owner_connection == owner_connection
            })
            .map(|(id, record)| (*id, record.entry.clock.saturating_add(1)))
            .collect();
        for (id, _) in &owned {
            awareness.remove(id);
        }
        drop(awareness);
        if owned.is_empty() {
            return;
        }
        let payload = AwarenessUpdate {
            clients: owned
                .into_iter()
                .map(|(id, clock)| {
                    (
                        id,
                        AwarenessUpdateEntry {
                            clock,
                            json: "null".into(),
                        },
                    )
                })
                .collect(),
        }
        .encode_v1();
        let _ = self.updates_tx.send(DocEvent::AwarenessUpdate {
            payload,
            origin: owner_client.clone(),
        });
    }

    /// Sync step 2 for a brand-new subscriber: pass `StateVector::default()`.
    /// On reconnect with a client-reported vector, this sends only the delta.
    pub async fn state_as_update(&self, state_vector: &StateVector) -> Vec<u8> {
        debug!("Updating state for tracking document.");
        let doc = self.doc.read().await;
        doc.transact().encode_diff_v1(state_vector)
    }

    pub async fn state_vector(&self) -> StateVector {
        self.doc.read().await.transact().state_vector()
    }

    async fn content_snapshot(&self) -> String {
        let doc = self.doc.read().await;
        let txn = doc.transact();
        txn.get_text("content")
            .map(|text| text.get_string(&txn))
            .unwrap_or_default()
    }

    pub async fn set_diagnostics(&self, diagnostics: Vec<LspDiagnostic>) {
        *self.diagnostics.write().await = diagnostics.clone();
        let _ = self.updates_tx.send(DocEvent::Diagnostics { diagnostics });
    }

    /// So a client that subscribes after diagnostics already arrived gets
    /// them immediately instead of waiting for the next publish.
    pub async fn latest_diagnostics(&self) -> Vec<LspDiagnostic> {
        self.diagnostics.read().await.clone()
    }

    async fn lsp_uri(&self) -> String {
        let (path, _) = self.location().await;
        format!("file://{}", path.display())
    }

    pub async fn ensure_lsp_open(&self, lsp: &LspServerActor) -> anyhow::Result<()> {
        if self.lsp_opened.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let text = self.content_snapshot().await;
        *self.last_synced_text.write().await = text.clone();
        let uri = self.lsp_uri().await;
        lsp.notify(
            "textDocument/didOpen",
            serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": lsp.language_id().as_str(),
                    "version": 0,
                    "text": text,
                }
            }),
        )
        .await
    }

    /// Full-document sync. Call this from a debounced flush task, never
    /// on every keystroke — see the "why full sync" note from earlier.
    pub async fn sync_to_lsp(&self, lsp: &LspServerActor) -> anyhow::Result<()> {
        let new_text = self.content_snapshot().await;
        let mut last = self.last_synced_text.write().await;

        if *last == new_text {
            return Ok(()); // nothing changed since the last successful sync
        }

        let version = self.lsp_version.fetch_add(1, Ordering::AcqRel) + 1;

        let change = if true
        /* lsp.sync_kind() == 2 */
        {
            match diff(&last, &new_text) {
                Some(c) => {
                    let encoding = "utf-16"; // lsp.position_encoding();
                    let start = byte_offset_to_position(&last, c.old_start, &encoding);
                    let end = byte_offset_to_position(&last, c.old_end, &encoding);
                    let value = serde_json::json!({
                        "range": {
                            "start": { "line": start.line, "character": start.character },
                            "end": { "line": end.line, "character": end.character },
                        },
                        "text": c.new_text,
                    });
                    debug!("Syncing code update to LSP");
                    value
                }
                None => return Ok(()), // unreachable given the equality check above
            }
        } else {
            // server only declared Full sync — send the whole document, same
            // as before. This is the fallback path, not a special case.
            serde_json::json!({ "text": new_text })
        };

        let uri = self.lsp_uri().await;
        lsp.notify(
            "textDocument/didChange",
            serde_json::json!({
                "textDocument": { "uri": uri, "version": version },
                "contentChanges": [change],
            }),
        )
        .await?;

        *last = new_text;
        Ok(())
    }

    /// Notify an attached language server after bytes have been persisted.
    /// Persistence remains authoritative: callers should ignore a notification
    /// failure after a successful disk write and leave the document clean.
    pub async fn notify_lsp_did_save(&self, lsp: &LspServerActor) -> anyhow::Result<()> {
        let uri = self.lsp_uri().await;
        lsp.notify(
            "textDocument/didSave",
            serde_json::json!({
                "textDocument": { "uri": uri },
            }),
        )
        .await
    }

    pub async fn ensure_lsp_closed(&self, lsp: &LspServerActor) -> anyhow::Result<()> {
        let (path, _) = self.location().await;
        self.notify_lsp_did_close_at(lsp, &path).await
    }

    /// Close the URI that was open before a filesystem rename/delete. The
    /// caller must provide the old path because the actor location is changed
    /// after the disk mutation commits.
    pub async fn notify_lsp_did_close_at(
        &self,
        lsp: &LspServerActor,
        path: &Path,
    ) -> anyhow::Result<()> {
        if !self.lsp_opened.swap(false, Ordering::AcqRel) {
            return Ok(());
        }
        let uri = format!("file://{}", path.display());
        lsp.notify(
            "textDocument/didClose",
            serde_json::json!({
                "textDocument": { "uri": uri }
            }),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use yrs::{ReadTxn, StateVector, Text, Transact, WriteTxn};

    async fn test_actor(initial: &str) -> (Arc<DocumentActor>, PathBuf, PathBuf) {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after epoch")
            .as_nanos();
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "forge-document-{}-{suffix}-{counter}",
            std::process::id()
        ));
        tokio::fs::create_dir_all(&directory)
            .await
            .expect("create test directory");
        let path = directory.join("document.txt");
        tokio::fs::write(&path, initial)
            .await
            .expect("write test document");
        let actor = DocumentActor::load(
            &"workspace".to_owned(),
            &"document.txt".to_owned(),
            path.clone(),
        )
        .await
        .expect("load test document");
        (actor, directory, path)
    }

    fn update_with_text(value: &str) -> Vec<u8> {
        let doc = yrs::Doc::new();
        {
            let mut txn = doc.transact_mut();
            let text = txn.get_or_insert_text("content");
            text.push(&mut txn, value);
        }
        doc.transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    fn awareness_update(client: u64, clock: u32, json: &str) -> Vec<u8> {
        AwarenessUpdate {
            clients: [(
                ClientID::new(client),
                AwarenessUpdateEntry {
                    clock,
                    json: json.into(),
                },
            )]
            .into_iter()
            .collect(),
        }
        .encode_v1()
    }

    #[tokio::test]
    async fn awareness_is_connection_owned_snapshotted_and_removed() {
        let (actor, directory, _) = test_actor("").await;
        actor
            .apply_awareness(
                awareness_update(7, 1, r#"{"user":{"name":"Ada"}}"#),
                "ada".into(),
                10,
            )
            .await
            .expect("apply awareness");

        let snapshot =
            AwarenessUpdate::decode_v1(&actor.awareness_snapshot().await).expect("decode snapshot");
        assert_eq!(snapshot.clients[&ClientID::new(7)].clock, 1);
        assert!(
            actor
                .apply_awareness(
                    awareness_update(7, 2, r#"{"user":{"name":"Mallory"}}"#),
                    "mallory".into(),
                    11,
                )
                .await
                .is_err()
        );

        let mut events = actor.subscribe_events();
        actor.remove_awareness_owner(&"ada".into(), 10).await;
        let DocEvent::AwarenessUpdate { payload, .. } = events.recv().await.expect("leave event")
        else {
            panic!("expected awareness leave update");
        };
        let leave = AwarenessUpdate::decode_v1(&payload).expect("decode leave");
        assert_eq!(leave.clients[&ClientID::new(7)].json.as_ref(), "null");
        assert!(
            AwarenessUpdate::decode_v1(&actor.awareness_snapshot().await)
                .expect("decode empty snapshot")
                .clients
                .is_empty()
        );

        tokio::fs::remove_dir_all(directory).await.expect("cleanup");
    }

    #[tokio::test]
    async fn lifecycle_snapshot_tracks_revision_and_save() {
        let (actor, directory, path) = test_actor("").await;
        assert_eq!(
            actor.lifecycle_snapshot().await.phase,
            PersistencePhase::Clean
        );
        assert!(!actor.is_dirty());

        let mut events = actor.subscribe_events();
        actor
            .apply_remote_update(&update_with_text("after"), "client".into())
            .await
            .expect("apply update");
        let _ = events.recv().await.expect("update event");
        let pending = events.recv().await.expect("pending event");
        assert!(matches!(
            pending,
            DocEvent::State {
                phase: PersistencePhase::Pending,
                revision: 1,
                persisted_revision: 0,
                ..
            }
        ));
        assert!(actor.is_dirty());

        let saved = actor.save().await.expect("save document");
        assert_eq!(saved.saved_revision, 1);
        assert_eq!(saved.current_revision, 1);
        let lifecycle = actor.lifecycle_snapshot().await;
        assert_eq!(lifecycle.phase, PersistencePhase::Clean);
        assert_eq!(lifecycle.revision, lifecycle.persisted_revision);
        assert_eq!(
            tokio::fs::read_to_string(path)
                .await
                .expect("read document"),
            "after"
        );

        tokio::fs::remove_dir_all(directory).await.expect("cleanup");
    }

    #[tokio::test]
    async fn failed_save_stays_dirty_and_can_be_retried() {
        let (actor, directory, original_path) = test_actor("").await;
        actor
            .apply_remote_update(&update_with_text("after"), "client".into())
            .await
            .expect("apply update");

        let missing_parent = directory.join("missing").join("document.txt");
        actor
            .update_location(missing_parent)
            .await
            .expect("move actor location");
        assert!(actor.save().await.is_err());
        let failed = actor.lifecycle_snapshot().await;
        assert_eq!(failed.phase, PersistencePhase::SaveError);
        assert!(failed.error.is_some());
        assert!(actor.is_dirty());

        actor
            .update_location(original_path.clone())
            .await
            .expect("restore actor location");
        actor.save().await.expect("retry save");
        assert_eq!(
            actor.lifecycle_snapshot().await.phase,
            PersistencePhase::Clean
        );
        assert_eq!(
            tokio::fs::read_to_string(original_path)
                .await
                .expect("read document"),
            "after"
        );

        tokio::fs::remove_dir_all(directory).await.expect("cleanup");
    }

    #[tokio::test]
    async fn save_result_preserves_newer_revision_as_dirty() {
        let (actor, directory, path) = test_actor("").await;
        actor
            .apply_remote_update(&update_with_text("first"), "client".into())
            .await
            .expect("apply first update");
        let first = actor.save().await.expect("save first update");

        actor
            .apply_remote_update(&update_with_text("second"), "client".into())
            .await
            .expect("apply second update");
        assert_eq!(first.saved_revision, 1);
        assert_eq!(actor.generation(), 2);
        assert!(actor.is_dirty());
        actor.save().await.expect("save second update");
        let saved_content = tokio::fs::read_to_string(path)
            .await
            .expect("read document");
        assert!(saved_content.contains("second"));

        tokio::fs::remove_dir_all(directory).await.expect("cleanup");
    }

    #[tokio::test]
    async fn duplicate_or_empty_updates_do_not_advance_revision() {
        let (actor, directory, _path) = test_actor("").await;
        let update = update_with_text("once");
        actor
            .apply_remote_update(&update, "client".into())
            .await
            .expect("apply update");
        assert_eq!(actor.generation(), 1);

        actor
            .apply_remote_update(&update, "client".into())
            .await
            .expect("replay update");
        assert_eq!(actor.generation(), 1);

        actor
            .apply_remote_update(&[], "client".into())
            .await
            .expect("apply empty update");
        assert_eq!(actor.generation(), 1);

        tokio::fs::remove_dir_all(directory).await.expect("cleanup");
    }

    #[tokio::test]
    async fn deletion_only_update_advances_revision_and_is_broadcast() {
        let (actor, directory, _path) = test_actor("selected text").await;
        let client = yrs::Doc::new();
        client
            .transact_mut()
            .apply_update(
                Update::decode_v1(&actor.state_as_update(&StateVector::default()).await)
                    .expect("decode initial state"),
            )
            .expect("apply initial state");
        let updates = Arc::new(std::sync::Mutex::new(Vec::<Vec<u8>>::new()));
        let captured = updates.clone();
        let _subscription = client.observe_update_v1(move |_, event| {
            captured
                .lock()
                .expect("lock updates")
                .push(event.update.clone());
        });
        {
            let mut txn = client.transact_mut();
            let text = txn.get_text("content").expect("content text");
            text.remove_range(&mut txn, 0, 8);
        }
        let update = updates
            .lock()
            .expect("lock updates")
            .pop()
            .expect("delete update");
        let mut events = actor.subscribe_events();

        actor
            .apply_remote_update(&update, "client".into())
            .await
            .expect("apply deletion");

        assert_eq!(actor.generation(), 1);
        assert_eq!(actor.content_snapshot().await, " text");
        assert!(matches!(
            events.recv().await.expect("update event"),
            DocEvent::Update { .. }
        ));
        tokio::fs::remove_dir_all(directory).await.expect("cleanup");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn atomic_save_preserves_existing_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let (actor, directory, path) = test_actor("").await;
        tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640))
            .await
            .expect("set test permissions");
        actor
            .apply_remote_update(&update_with_text("updated"), "client".into())
            .await
            .expect("apply update");
        actor.save().await.expect("save document");

        let mode = tokio::fs::metadata(&path)
            .await
            .expect("read saved permissions")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o640);
        tokio::fs::remove_dir_all(directory).await.expect("cleanup");
    }
}
