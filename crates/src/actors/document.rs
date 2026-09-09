// src/document.rs
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicUsize, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use tokio::{
    sync::{broadcast, Mutex as AsyncMutex, RwLock},
    task::JoinHandle,
};
use tracing::{debug, info, warn};
use yrs::{GetString, ReadTxn, StateVector, Text, Transact, Update, updates::decoder::Decode};

use crate::{
    util::{diff, byte_offset_to_position},
    actors::LspServerActor, models::{ClientId, DocEvent, FileId, LspDiagnostic, WorkspaceId}, state::AppState,
};
use yrs::WriteTxn;

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
    path: PathBuf,
    workspace_id: WorkspaceId,
    file_id: FileId,
    doc: RwLock<yrs::Doc>,
    updates_tx: broadcast::Sender<DocEvent>,
    editable: AtomicBool,
    dirty: AtomicBool,
    subscribers: AtomicUsize,
    last_activity: AtomicI64,
    lsp_opened: AtomicBool,
    lsp_version: AtomicI64,
    diagnostics: RwLock<Vec<LspDiagnostic>>,
    edit_generation: AtomicU64,
    last_synced_text: RwLock<String>,
    eviction_task: AsyncMutex<Option<JoinHandle<()>>>,
}

impl std::fmt::Debug for DocumentActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DocumentActor")
            .field("path", &self.path)
            .field("workspace_id", &self.workspace_id)
            .field("file_id", &self.file_id)
            .field("subscribers", &self.subscribers)
            .finish()
    }
}

impl DocumentActor {
    pub async fn load(workspace_id: &WorkspaceId, file_id: &FileId, path: PathBuf) -> anyhow::Result<Arc<Self>> {
        let content = tokio::fs::read_to_string(&path).await?;
        debug!("Path {:?} content {}", path, content);
        let doc = yrs::Doc::new();
        {
            let mut txn = doc.transact_mut();
            let text = txn.get_or_insert_text("content");
            text.push(&mut txn, &content);
        }

        Ok(Arc::new(Self {
            path,
            workspace_id: workspace_id.clone(),
            file_id: file_id.clone(),
            doc: RwLock::new(doc),
            updates_tx: broadcast::channel(256).0,
            editable: AtomicBool::new(true),
            dirty: AtomicBool::new(false),
            subscribers: AtomicUsize::new(0),
            last_activity: AtomicI64::new(now_ms()),
            lsp_opened: AtomicBool::new(false),
            lsp_version: AtomicI64::new(0),
            diagnostics: RwLock::new(Vec::new()),
            edit_generation: AtomicU64::new(0),
            last_synced_text: RwLock::new(content),
            eviction_task: AsyncMutex::new(None),
        }))
    }

    pub fn path_matches(&self, path: &str) -> bool {
        self.path == Path::new(path)
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<DocEvent> {
        self.updates_tx.subscribe()
    }

    /// Call when a client subscribes. Bumps refcount and cancels any
    /// pending eviction — e.g. a tab refresh that reconnected inside the
    /// debounce window shouldn't lose the in-memory doc.
    pub async fn subscribe(&self) {
        debug!("Client has subscribed to the document {:?}", self.path);
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
        let remaining = self.subscribers.fetch_sub(1, Ordering::AcqRel) - 1;
        self.last_activity.store(now_ms(), Ordering::Relaxed);
        if remaining > 0 {
            return;
        }

        let this = self.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if this.subscribers.load(Ordering::Acquire) != 0 {
                return; // someone resubscribed during the debounce window
            }
            if this.dirty.load(Ordering::Acquire) {
                if let Err(e) = this.flush_to_disk().await {
                    warn!("failed to flush {:?} before eviction: {e}", this.path);
                    return; // don't evict data we failed to persist
                }
            }
            info!("evicting idle document {:?}", this.path);
            state.open_files.remove(&key);
        });

        *self.eviction_task.lock().await = Some(handle);
    }

    pub async fn apply_remote_update(self: &Arc<Self>, update: &[u8], origin: ClientId) -> anyhow::Result<u64> {
        if !self.editable.load(Ordering::Acquire) {
            anyhow::bail!("document is read-only");
        }

        let decoded = Update::decode_v1(update)?;
        {
            let doc = self.doc.read().await;
            let mut txn = doc.transact_mut();
            txn.apply_update(decoded)?;
        }

        self.dirty.store(true, Ordering::Release);
        self.last_activity.store(now_ms(), Ordering::Relaxed);
        let generation = self.edit_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let _ = self.updates_tx.send(DocEvent::Update { update: update.to_vec(), origin });

        // Debounced LSP push. Every edit spawns one of these, but only the task
        // that sees no further edits within the window actually does anything —
        // the rest bail on the generation check. Cheap enough not to bother
        // cancelling the losers.
        // let this = self.clone();
        // tokio::spawn(async move {
        //     tokio::time::sleep(Duration::from_millis(400)).await;
        //     if this.edit_generation.load(Ordering::Acquire) != generation {
        //         return; // a later edit landed — that task will handle the sync
        //     }
        //     let Some(lsp) = this.lsp.read().await.clone() else {
        //         return; // no LSP attached (unsupported language, or spawn failed)
        //     };
        //     if let Err(e) = this.sync_to_lsp(&lsp).await {
        //         warn!("failed to sync {:?} to lsp: {e}", this.path);
        //     }
        // });

        // Debounced disk flush, independent of the eviction path. This is what
        // bounds crash data-loss during a long-lived session with active
        // subscribers — eviction only flushes after everyone leaves.
        let this = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            if this.edit_generation.load(Ordering::Acquire) != generation {
                return;
            }
            if !this.dirty.load(Ordering::Acquire) {
                return; // already flushed by something else (e.g. eviction) meanwhile
            }
            debug!("Attempting to write {:?} to disk", this.path);
            if let Err(e) = this.flush_to_disk().await {
                warn!("autosave failed for {:?}: {e}", this.path);
            }
        });

        Ok(self.generation())
    }

    pub fn generation(&self) -> u64 {
        self.edit_generation.load(Ordering::Acquire)
    }

    /// Opaque to the server — see earlier discussion. Just fan it out.
    pub fn apply_awareness(&self, payload: Vec<u8>, origin: ClientId) {
        let _ = self.updates_tx.send(DocEvent::Awareness { payload, origin });
    }

    /// Sync step 2 for a brand-new subscriber: pass `StateVector::default()`.
    /// On reconnect with a client-reported vector, this sends only the delta.
    pub async fn state_as_update(&self, state_vector: &StateVector) -> Vec<u8> {
        debug!("Updating state for tracking document.");
        let doc = self.doc.read().await;
        doc.transact().encode_diff_v1(state_vector)
    }

    // pub async fn state_vector(&self) -> StateVector {
    //     self.doc.read().await.transact().state_vector()
    // }

    async fn content_snapshot(&self) -> String {
        let doc = self.doc.read().await;
        let txn = doc.transact();
        txn.get_text("content")
            .map(|text| text.get_string(&txn))
            .unwrap_or_default()
    }

    async fn flush_to_disk(&self) -> anyhow::Result<()> {
        let content = self.content_snapshot().await;
        tokio::fs::write(&self.path, content).await?;
        self.dirty.store(false, Ordering::Release);
        Ok(())
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

    fn lsp_uri(&self) -> String {
        format!("file://{}", self.path.display())
    }

    pub async fn ensure_lsp_open(&self, lsp: &LspServerActor) -> anyhow::Result<()> {
        if self.lsp_opened.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let text = self.content_snapshot().await;
        *self.last_synced_text.write().await = text.clone();
        lsp.notify("textDocument/didOpen", serde_json::json!({
            "textDocument": {
                "uri": self.lsp_uri(),
                "languageId": lsp.language_id().as_str(),
                "version": 0,
                "text": text,
            }
        })).await
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
    
        let change = if true /* lsp.sync_kind() == 2 */ {
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
                    debug!("Syncing code update to LSP {:?}", value);
                    value
                }
                None => return Ok(()), // unreachable given the equality check above
            }
        } else {
            // server only declared Full sync — send the whole document, same
            // as before. This is the fallback path, not a special case.
            serde_json::json!({ "text": new_text })
        };
    
        lsp.notify("textDocument/didChange", serde_json::json!({
            "textDocument": { "uri": self.lsp_uri(), "version": version },
            "contentChanges": [change],
        })).await?;
    
        *last = new_text;
        Ok(())
    }

    pub async fn ensure_lsp_closed(&self, lsp: &LspServerActor) -> anyhow::Result<()> {
        if !self.lsp_opened.swap(false, Ordering::AcqRel) {
            return Ok(());
        }
        lsp.notify("textDocument/didClose", serde_json::json!({
            "textDocument": { "uri": self.lsp_uri() }
        })).await
    }
}