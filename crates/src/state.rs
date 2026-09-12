use dashmap::{DashMap, DashSet};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::{
    sync::{Mutex as AsyncMutex, mpsc},
    task::JoinHandle,
};

use crate::{
    actors::{DocumentActor, LspServerActor, TerminalActor},
    config::Config,
    models::{ClientId, FileId, LanguageId, ServerMessage, TerminalId, WorkspaceId},
};

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub open_files: Arc<DashMap<(WorkspaceId, FileId), Arc<DocumentActor>>>,
    pub terminals: Arc<DashMap<TerminalId, Arc<TerminalActor>>>,
    pub lsp_servers: Arc<DashMap<(WorkspaceId, LanguageId), Arc<LspServerActor>>>,
    pub clients: Arc<DashMap<ClientId, ClientConnectionHandle>>,
    /// Stable only for this websocket connection. A reconnect may reuse the
    /// same client id, so cleanup must also match this identity.
    next_connection_id: Arc<AtomicU64>,
    /// Serializes filesystem path mutations for the (currently single)
    /// workspace. DocumentActor save locks still provide per-document
    /// serialization for ordinary saves.
    pub(crate) fs_mutation_lock: Arc<AsyncMutex<()>>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        Self {
            config: Arc::new(config),
            open_files: Arc::new(DashMap::new()),
            terminals: Arc::new(DashMap::new()),
            lsp_servers: Arc::new(DashMap::new()),
            clients: Arc::new(DashMap::new()),
            next_connection_id: Arc::new(AtomicU64::new(1)),
            fs_mutation_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    pub fn new_client_connection(
        &self,
        document_tx: mpsc::Sender<ServerMessage>,
    ) -> ClientConnectionHandle {
        ClientConnectionHandle::new(
            self.next_connection_id.fetch_add(1, Ordering::Relaxed),
            document_tx,
        )
    }
}

#[derive(Debug)]
pub struct ClientConnectionHandle {
    pub connection_id: u64,
    pub document_tx: mpsc::Sender<ServerMessage>,
    pub subscribed_documents: DashSet<(WorkspaceId, FileId)>,
    pub open_terminals: DashSet<TerminalId>,
    pub authorized_workspaces: DashSet<WorkspaceId>,
    /// forwarder tasks piping DocumentActor broadcast events -> this
    /// client's sender. Must be aborted on unsubscribe/disconnect or
    /// they'll leak and keep sending to a dead channel forever.
    pub doc_forwarders: DashMap<(WorkspaceId, FileId), JoinHandle<()>>,
}

impl ClientConnectionHandle {
    fn new(connection_id: u64, document_tx: mpsc::Sender<ServerMessage>) -> Self {
        Self {
            connection_id,
            document_tx,
            subscribed_documents: DashSet::new(),
            open_terminals: DashSet::new(),
            authorized_workspaces: DashSet::new(),
            doc_forwarders: DashMap::new(),
        }
    }
}

impl AppState {
    pub fn to_absolute_path(&self, path: impl Into<PathBuf>) -> anyhow::Result<PathBuf> {
        return Self::base_to_absolute_path(&self.config.base_dir, &path.into());
    }

    pub fn base_to_absolute_path(base: &Path, relative: &Path) -> anyhow::Result<PathBuf> {
        let normalized = crate::utils::workspace_path::normalize_workspace_relative(relative)?;
        Ok(base.join(normalized))
    }

    pub fn workspace_root(&self, _workspace_id: &WorkspaceId) -> PathBuf {
        self.config.base_dir.clone()
    }

    pub fn resolve_file_path(
        &self,
        _workspace_id: &WorkspaceId,
        file_id: &FileId,
    ) -> anyhow::Result<PathBuf> {
        Self::base_to_absolute_path(&self.config.base_dir, &PathBuf::from(file_id))
    }

    pub fn authorize(
        &self,
        _client_id: &ClientId,
        _workspace_id: &WorkspaceId,
    ) -> anyhow::Result<bool> {
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::AppState;
    use std::path::{Path, PathBuf};

    #[test]
    fn resolver_allows_one_leading_slash_without_allowing_escape() {
        let base = Path::new("/workspace");
        assert_eq!(
            AppState::base_to_absolute_path(base, Path::new("/src/main.rs")).unwrap(),
            PathBuf::from("/workspace/src/main.rs")
        );
        assert_eq!(
            AppState::base_to_absolute_path(base, Path::new("src/./main.rs")).unwrap(),
            PathBuf::from("/workspace/src/main.rs")
        );
        assert!(AppState::base_to_absolute_path(base, Path::new("../outside")).is_err());
        assert!(AppState::base_to_absolute_path(base, Path::new("/src/../../outside")).is_err());
        assert!(AppState::base_to_absolute_path(base, Path::new("//outside")).is_err());
    }
}
