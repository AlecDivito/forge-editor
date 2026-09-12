//! Coordinated filesystem mutations for open documents.
//!
//! A single mutation mutex is intentional for the current server, which has
//! one configured workspace. It can become a per-workspace map when multiple
//! roots are introduced. Document save locks are held across the disk
//! operation and registry commit, so an old autosave cannot recreate a path
//! after a rename/delete is committed.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use tracing::{info, warn};

use crate::{
    actors::DocumentActor,
    error::AppError,
    models::{
        ClientId, CreateFile, DeleteCommit, FileId, FsEntryType, FsFileType, LanguageId,
        MutationError, RenameCommit, SaveFile, ServerMessage, WorkspaceId,
    },
    state::{AppState, ClientConnectionHandle},
    utils::workspace_mutation::{
        canonical_file_id, display_relative, ensure_parent_inside, entry_type, is_affected,
        normalize_workspace_relative, relative_actor_path, remapped_path,
    },
};

/// Load a document while excluding rename/delete commits, so an old path
/// cannot be reintroduced into the registry after a mutation commits.
pub async fn get_or_load_document(
    state: &AppState,
    workspace_id: &WorkspaceId,
    file_id: &FileId,
) -> anyhow::Result<Arc<DocumentActor>> {
    let _mutation = state.fs_mutation_lock.lock().await;
    let key = (workspace_id.clone(), file_id.clone());
    if let Some(existing) = state.open_files.get(&key) {
        return Ok(existing.value().clone());
    }

    let path = state.resolve_file_path(workspace_id, file_id)?;
    let doc = DocumentActor::load(workspace_id, file_id, path).await?;
    match state.open_files.entry(key) {
        Entry::Occupied(entry) => Ok(entry.get().clone()),
        Entry::Vacant(entry) => Ok(entry.insert(doc).clone()),
    }
}

/// The legacy HTTP save endpoint may only write documents that are not
/// currently owned by a `DocumentActor`.
pub async fn save_legacy(state: &AppState, body: &SaveFile) -> Result<(), AppError> {
    let _mutation = state.fs_mutation_lock.lock().await;
    let local_path = state.to_absolute_path(&body.path)?;
    let open_documents: Vec<_> = state
        .open_files
        .iter()
        .map(|entry| entry.value().clone())
        .collect();
    for document in open_documents {
        let (open_path, _) = document.location().await;
        if open_path == local_path {
            return Err(AppError::Conflict(
                "file is open in the editor; save it through the document websocket".into(),
            ));
        }
    }

    if !local_path.is_file() {
        return Err(AppError::String(
            "Updating non file is not supported".into(),
        ));
    }
    tokio::fs::write(local_path, &body.contents).await?;
    Ok(())
}

pub async fn create(state: &AppState, body: &CreateFile) -> Result<(), AppError> {
    let _mutation = state.fs_mutation_lock.lock().await;
    let local_path = state.to_absolute_path(&body.path)?;
    match body.ty {
        FsFileType::Directory => tokio::fs::create_dir(local_path).await?,
        FsFileType::File => tokio::fs::write(local_path, "").await?,
        FsFileType::SymLink => {
            return Err(AppError::String(
                "Creating sym link is not supported".into(),
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct OpenDocument {
    old_key: (WorkspaceId, FileId),
    actor: Arc<DocumentActor>,
    old_relative: PathBuf,
    old_language: Option<LanguageId>,
}

async fn collect_open_documents(
    state: &AppState,
    workspace_id: &WorkspaceId,
    root: &Path,
    target: &Path,
    directory: bool,
) -> Vec<OpenDocument> {
    let mut documents = Vec::new();
    for entry in state.open_files.iter() {
        let (key, actor) = (entry.key().clone(), entry.value().clone());
        if &key.0 != workspace_id {
            continue;
        }
        let (path, _) = actor.location().await;
        if is_affected(&path, root, target, directory) {
            let old_language = LanguageId::from_path(&path).await;
            documents.push(OpenDocument {
                old_key: key,
                actor,
                old_relative: relative_actor_path(root, &path).unwrap_or_default(),
                old_language,
            });
        }
    }
    documents.sort_by(|a, b| a.old_key.cmp(&b.old_key));
    documents.dedup_by(|a, b| a.old_key == b.old_key);
    documents
}

async fn close_lsp_documents(
    state: &AppState,
    workspace_id: &WorkspaceId,
    root: &Path,
    documents: &[OpenDocument],
) {
    for document in documents {
        let old_path = root.join(&document.old_relative);
        let Some(language) = document.old_language else {
            continue;
        };
        let lsp = state
            .lsp_servers
            .get(&(workspace_id.clone(), language))
            .map(|entry| entry.value().clone());
        let Some(lsp) = lsp else { continue };
        // LSP state is advisory. Filesystem and document registry commits must
        // not be rolled back because a language server is unavailable.
        if let Err(error) = document
            .actor
            .notify_lsp_did_close_at(&lsp, &old_path)
            .await
        {
            warn!("failed to close old LSP URI {old_path:?}: {error}");
        }
    }
}

fn remap_client_bookkeeping(
    clients: &DashMap<ClientId, ClientConnectionHandle>,
    mapping: &HashMap<(WorkspaceId, FileId), (WorkspaceId, FileId)>,
    remove: bool,
) {
    for client in clients.iter() {
        let handle = client.value();
        let keys: Vec<_> = handle
            .subscribed_documents
            .iter()
            .map(|entry| entry.key().clone())
            .collect();
        for old_key in keys {
            let Some(new_key) = mapping.get(&old_key) else {
                continue;
            };
            handle.subscribed_documents.remove(&old_key);
            if remove {
                continue;
            }
            handle.subscribed_documents.insert(new_key.clone());
        }

        let keys: Vec<_> = handle
            .doc_forwarders
            .iter()
            .map(|entry| entry.key().clone())
            .collect();
        for old_key in keys {
            let Some(new_key) = mapping.get(&old_key) else {
                continue;
            };
            if let Some((_, task)) = handle.doc_forwarders.remove(&old_key) {
                if !remove {
                    handle.doc_forwarders.insert(new_key.clone(), task);
                } else {
                    task.abort();
                }
            }
        }
    }
}

fn broadcast(state: &AppState, message: ServerMessage, _workspace_id: &WorkspaceId) {
    // The current server authorizes every connection against one workspace.
    // Keep this as an all-client broadcast so file-tree-only clients receive
    // mutations; apply workspace authorization filtering when roots become
    // independently scoped.
    let senders: Vec<_> = state
        .clients
        .iter()
        .map(|client| client.value().document_tx.clone())
        .collect();
    for sender in senders {
        if let Err(error) = sender.try_send(message.clone()) {
            warn!("dropping filesystem event for a full client channel: {error}");
        }
    }
}

pub async fn rename(
    state: &AppState,
    workspace_id: &WorkspaceId,
    from_raw: &str,
    to_raw: &str,
) -> Result<RenameCommit, MutationError> {
    let from = normalize_workspace_relative(from_raw)?;
    let to = normalize_workspace_relative(to_raw)?;
    if from == to {
        return Err(MutationError::Conflict(
            "source and destination are identical".into(),
        ));
    }
    let root = state.workspace_root(workspace_id);
    let from_path = root.join(&from);
    let to_path = root.join(&to);
    let _mutation = state.fs_mutation_lock.lock().await;
    ensure_parent_inside(&root, &from_path).await?;
    ensure_parent_inside(&root, &to_path).await?;
    let ty = entry_type(&from_path).await.map_err(|error| match error {
        MutationError::Io(ref io) if io.kind() == std::io::ErrorKind::NotFound => {
            MutationError::NotFound(format!("source path does not exist: {from_raw}"))
        }
        other => other,
    })?;
    if tokio::fs::symlink_metadata(&to_path).await.is_ok() {
        warn!(
            workspace_id = %workspace_id,
            from = %from_raw,
            to = %to_raw,
            "filesystem rename rejected: destination exists"
        );
        return Err(MutationError::Conflict("destination already exists".into()));
    }

    let documents = collect_open_documents(
        state,
        workspace_id,
        &root,
        &from,
        ty == FsEntryType::Directory,
    )
    .await;
    let mut guards = Vec::with_capacity(documents.len());
    for document in &documents {
        guards.push(document.actor.acquire_save_lock().await);
    }

    // A destination may be absent on disk while still being represented by a
    // stale/open actor. Refuse the mutation before touching the filesystem.
    let affected_keys: std::collections::HashSet<_> = documents
        .iter()
        .map(|document| document.old_key.clone())
        .collect();
    for document in &documents {
        let new_relative = remapped_path(
            &document.old_relative,
            &from,
            &to,
            ty == FsEntryType::Directory,
        );
        let new_key = (workspace_id.clone(), canonical_file_id(&new_relative));
        if let Some(existing) = state.open_files.get(&new_key) {
            if !affected_keys.contains(existing.key()) {
                warn!(
                    workspace_id = %workspace_id,
                    from = %from_raw,
                    to = %to_raw,
                    file_id = %new_key.1,
                    "filesystem rename rejected: destination document is open"
                );
                return Err(MutationError::Conflict(format!(
                    "destination document is already open: {}",
                    new_key.1
                )));
            }
        }
    }

    tokio::fs::rename(&from_path, &to_path).await?;

    close_lsp_documents(state, workspace_id, &root, &documents).await;

    let mut mapping = HashMap::new();
    for document in &documents {
        let new_relative = remapped_path(
            &document.old_relative,
            &from,
            &to,
            ty == FsEntryType::Directory,
        );
        let new_id = canonical_file_id(&new_relative);
        let new_key = (workspace_id.clone(), new_id.clone());
        state.open_files.remove(&document.old_key);
        document
            .actor
            .relocate_after_commit(new_id.clone(), root.join(&new_relative))
            .await;
        state
            .open_files
            .insert(new_key.clone(), document.actor.clone());
        mapping.insert(document.old_key.clone(), new_key);
    }
    remap_client_bookkeeping(&state.clients, &mapping, false);
    drop(guards);

    let commit = RenameCommit {
        from: display_relative(&from),
        to: display_relative(&to),
        entry_type: ty,
    };
    info!(
        workspace_id = %workspace_id,
        from = %commit.from,
        to = %commit.to,
        entry_type = ?commit.entry_type,
        open_documents = documents.len(),
        "filesystem rename committed"
    );
    broadcast(
        state,
        ServerMessage::FsRenamed {
            workspace_id: workspace_id.clone(),
            from: commit.from.clone(),
            to: commit.to.clone(),
            entry_type: commit.entry_type,
        },
        workspace_id,
    );
    Ok(commit)
}

pub async fn delete(
    state: &AppState,
    workspace_id: &WorkspaceId,
    raw: &str,
) -> Result<DeleteCommit, MutationError> {
    let path = normalize_workspace_relative(raw)?;
    let root = state.workspace_root(workspace_id);
    let absolute = root.join(&path);
    let _mutation = state.fs_mutation_lock.lock().await;
    ensure_parent_inside(&root, &absolute).await?;
    let ty = entry_type(&absolute).await.map_err(|error| match error {
        MutationError::Io(ref io) if io.kind() == std::io::ErrorKind::NotFound => {
            MutationError::NotFound(format!("path does not exist: {raw}"))
        }
        other => other,
    })?;

    let documents = collect_open_documents(
        state,
        workspace_id,
        &root,
        &path,
        ty == FsEntryType::Directory,
    )
    .await;
    // Wait for any in-flight save before deciding whether a destructive
    // delete is allowed. A pre-lock dirty check could reject a save that is
    // already about to finish, or observe a stale lifecycle phase.
    let mut guards = Vec::with_capacity(documents.len());
    for document in &documents {
        guards.push(document.actor.acquire_save_lock().await);
    }
    let dirty: Vec<_> = documents
        .iter()
        .filter(|document| document.actor.is_dirty())
        .map(|document| display_relative(&document.old_relative))
        .collect();
    if !dirty.is_empty() {
        warn!(
            workspace_id = %workspace_id,
            path = %raw,
            dirty_documents = dirty.len(),
            "filesystem delete rejected: open documents are dirty"
        );
        return Err(MutationError::Conflict(format!(
            "dirty open documents: {}",
            dirty.join(", ")
        )));
    }

    if ty == FsEntryType::Directory {
        tokio::fs::remove_dir_all(&absolute).await?;
    } else {
        tokio::fs::remove_file(&absolute).await?;
    }

    close_lsp_documents(state, workspace_id, &root, &documents).await;

    let mut mapping = HashMap::new();
    for document in &documents {
        document.actor.mark_deleted_locked().await;
        state.open_files.remove(&document.old_key);
        mapping.insert(document.old_key.clone(), document.old_key.clone());
    }
    remap_client_bookkeeping(&state.clients, &mapping, true);
    drop(guards);

    let commit = DeleteCommit {
        path: display_relative(&path),
        entry_type: ty,
        affected_paths: documents
            .into_iter()
            .map(|document| display_relative(&document.old_relative))
            .collect(),
    };
    info!(
        workspace_id = %workspace_id,
        path = %commit.path,
        entry_type = ?commit.entry_type,
        open_documents = commit.affected_paths.len(),
        "filesystem delete committed"
    );
    broadcast(
        state,
        ServerMessage::FsDeleted {
            workspace_id: workspace_id.clone(),
            path: commit.path.clone(),
            entry_type: commit.entry_type,
        },
        workspace_id,
    );
    Ok(commit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{actors::DocumentActor, config::Config};
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };
    use yrs::{ReadTxn, StateVector, Text, Transact, WriteTxn};

    static TEST_ROOT_COUNTER: AtomicU64 = AtomicU64::new(0);

    async fn test_state(name: &str, content: &str) -> (AppState, PathBuf) {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after epoch")
            .as_nanos();
        let counter = TEST_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "forge-fs-coordinator-{}-{suffix}-{counter}",
            std::process::id(),
        ));
        tokio::fs::create_dir_all(&root).await.expect("create root");
        tokio::fs::write(root.join(name), content)
            .await
            .expect("create file");
        (
            AppState::new(Config {
                port: 0,
                base_dir: root.clone(),
            }),
            root,
        )
    }

    fn text_update(value: &str) -> Vec<u8> {
        let doc = yrs::Doc::new();
        let mut txn = doc.transact_mut();
        txn.get_or_insert_text("content").push(&mut txn, value);
        drop(txn);
        doc.transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn normalization_rejects_traversal_and_accepts_legacy_rooted_paths() {
        assert_eq!(
            normalize_workspace_relative("/src/./main.rs").unwrap(),
            PathBuf::from("src/main.rs")
        );
        assert!(matches!(
            normalize_workspace_relative("../outside"),
            Err(MutationError::BadPath(_))
        ));
        assert!(matches!(
            normalize_workspace_relative("/src/../../outside"),
            Err(MutationError::BadPath(_))
        ));
        assert!(matches!(
            normalize_workspace_relative("/"),
            Err(MutationError::BadPath(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn normalization_rejects_absolute_prefixes() {
        assert!(matches!(
            normalize_workspace_relative("//etc/passwd"),
            Err(MutationError::BadPath(_))
        ));
    }

    #[tokio::test]
    async fn rename_rekeys_open_actor_and_preserves_state() {
        let (state, root) = test_state("old.txt", "hello").await;
        let workspace = "workspace".to_string();
        let file_id = "/old.txt".to_string();
        let actor = DocumentActor::load(&workspace, &file_id, root.join("old.txt"))
            .await
            .expect("load actor");
        state
            .open_files
            .insert((workspace.clone(), file_id.clone()), actor.clone());

        rename(&state, &workspace, "/old.txt", "/new.txt")
            .await
            .expect("rename");

        assert!(!root.join("old.txt").exists());
        assert!(root.join("new.txt").exists());
        assert!(!state.open_files.contains_key(&(workspace.clone(), file_id)));
        let new_actor = state
            .open_files
            .get(&(workspace.clone(), "/new.txt".into()))
            .expect("re-keyed actor");
        assert!(Arc::ptr_eq(new_actor.value(), &actor));
        assert_eq!(actor.file_id().await, "/new.txt");
        assert_eq!(actor.location().await.0, root.join("new.txt"));
        tokio::fs::remove_dir_all(root).await.expect("cleanup");
    }

    #[tokio::test]
    async fn directory_rename_rekeys_descendants_and_notifies_subscribers() {
        let (state, root) = test_state("placeholder.txt", "").await;
        tokio::fs::create_dir_all(root.join("old/nested"))
            .await
            .expect("create source directory");
        tokio::fs::create_dir_all(root.join("oldish"))
            .await
            .expect("create sibling directory");
        tokio::fs::write(root.join("old/main.rs"), "main")
            .await
            .expect("create source file");
        tokio::fs::write(root.join("old/nested/lib.rs"), "lib")
            .await
            .expect("create nested source file");
        tokio::fs::write(root.join("oldish/main.rs"), "sibling")
            .await
            .expect("create sibling file");

        let workspace = "workspace".to_string();
        let main = DocumentActor::load(
            &workspace,
            &"/old/main.rs".to_string(),
            root.join("old/main.rs"),
        )
        .await
        .expect("load source actor");
        let nested = DocumentActor::load(
            &workspace,
            &"/old/nested/lib.rs".to_string(),
            root.join("old/nested/lib.rs"),
        )
        .await
        .expect("load nested actor");
        let sibling = DocumentActor::load(
            &workspace,
            &"/oldish/main.rs".to_string(),
            root.join("oldish/main.rs"),
        )
        .await
        .expect("load sibling actor");
        state
            .open_files
            .insert((workspace.clone(), "/old/main.rs".into()), main.clone());
        state.open_files.insert(
            (workspace.clone(), "/old/nested/lib.rs".into()),
            nested.clone(),
        );
        state.open_files.insert(
            (workspace.clone(), "/oldish/main.rs".into()),
            sibling.clone(),
        );

        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        let client = state.new_client_connection(sender);
        client
            .subscribed_documents
            .insert((workspace.clone(), "/old/main.rs".into()));
        client
            .subscribed_documents
            .insert((workspace.clone(), "/old/nested/lib.rs".into()));
        client
            .subscribed_documents
            .insert((workspace.clone(), "/oldish/main.rs".into()));
        state.clients.insert("client".into(), client);

        rename(&state, &workspace, "/old", "/archive")
            .await
            .expect("rename");

        assert!(root.join("archive/main.rs").exists());
        assert!(root.join("archive/nested/lib.rs").exists());
        assert!(
            !state
                .open_files
                .contains_key(&(workspace.clone(), "/old/main.rs".into()))
        );
        assert!(Arc::ptr_eq(
            state
                .open_files
                .get(&(workspace.clone(), "/archive/main.rs".into()))
                .expect("rekeyed main actor")
                .value(),
            &main
        ));
        assert!(Arc::ptr_eq(
            state
                .open_files
                .get(&(workspace.clone(), "/archive/nested/lib.rs".into()))
                .expect("rekeyed nested actor")
                .value(),
            &nested
        ));
        assert!(Arc::ptr_eq(
            state
                .open_files
                .get(&(workspace.clone(), "/oldish/main.rs".into()))
                .expect("unchanged sibling actor")
                .value(),
            &sibling
        ));

        let subscriptions = state.clients.get("client").expect("client");
        assert!(
            subscriptions
                .subscribed_documents
                .contains(&(workspace.clone(), "/archive/main.rs".into()))
        );
        assert!(
            subscriptions
                .subscribed_documents
                .contains(&(workspace.clone(), "/archive/nested/lib.rs".into()))
        );
        assert!(
            subscriptions
                .subscribed_documents
                .contains(&(workspace.clone(), "/oldish/main.rs".into()))
        );
        assert!(
            !subscriptions
                .subscribed_documents
                .contains(&(workspace.clone(), "/old/main.rs".into()))
        );

        assert!(matches!(
            receiver.try_recv().expect("rename event"),
            ServerMessage::FsRenamed {
                from,
                to,
                entry_type: FsEntryType::Directory,
                ..
            } if from == "/old" && to == "/archive"
        ));

        tokio::fs::remove_dir_all(root).await.expect("cleanup");
    }

    #[tokio::test]
    async fn dirty_delete_is_rejected_without_discarding_document_state() {
        let (state, root) = test_state("dirty.txt", "hello").await;
        let workspace = "workspace".to_string();
        let file_id = "/dirty.txt".to_string();
        let actor = DocumentActor::load(&workspace, &file_id, root.join("dirty.txt"))
            .await
            .expect("load actor");
        actor
            .apply_remote_update(&text_update(" changed"), "client".into())
            .await
            .expect("edit actor");
        state
            .open_files
            .insert((workspace.clone(), file_id.clone()), actor.clone());
        assert!(matches!(
            delete(&state, &workspace, "/dirty.txt").await,
            Err(MutationError::Conflict(_))
        ));
        assert!(root.join("dirty.txt").exists());
        assert!(state.open_files.contains_key(&(workspace, file_id)));
        assert_ne!(
            actor.lifecycle_snapshot().await.phase,
            crate::models::PersistencePhase::Deleted
        );
        tokio::fs::remove_dir_all(root).await.expect("cleanup");
    }

    #[tokio::test]
    async fn rename_rejects_an_occupied_destination_registry_key() {
        let (state, root) = test_state("old.txt", "old").await;
        tokio::fs::write(root.join("new.txt"), "new")
            .await
            .expect("create destination");
        let workspace = "workspace".to_string();
        let old = DocumentActor::load(&workspace, &"/old.txt".to_string(), root.join("old.txt"))
            .await
            .expect("load old actor");
        let destination =
            DocumentActor::load(&workspace, &"/new.txt".to_string(), root.join("new.txt"))
                .await
                .expect("load destination actor");
        state
            .open_files
            .insert((workspace.clone(), "/old.txt".into()), old);
        state
            .open_files
            .insert((workspace.clone(), "/new.txt".into()), destination);
        tokio::fs::remove_file(root.join("new.txt"))
            .await
            .expect("remove destination disk entry");

        assert!(matches!(
            rename(&state, &workspace, "/old.txt", "/new.txt").await,
            Err(MutationError::Conflict(_))
        ));
        assert!(root.join("old.txt").exists());
        assert!(!root.join("new.txt").exists());
        tokio::fs::remove_dir_all(root).await.expect("cleanup");
    }
}
