use dashmap::{DashMap, DashSet};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{sync::mpsc, task::JoinHandle};

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
}

impl AppState {
    pub fn new(config: Config) -> Self {
        Self {
            config: Arc::new(config),
            open_files: Arc::new(DashMap::new()),
            terminals: Arc::new(DashMap::new()),
            lsp_servers: Arc::new(DashMap::new()),
            clients: Arc::new(DashMap::new()),
        }
    }
}

#[derive(Debug)]
pub struct ClientConnectionHandle {
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
    pub fn new(document_tx: mpsc::Sender<ServerMessage>) -> Self {
        Self {
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
        Ok(if relative.is_absolute() {
            base.join(relative.strip_prefix("/")?)
        } else {
            base.join(relative)
        })
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
