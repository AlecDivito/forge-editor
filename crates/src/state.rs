use dashmap::{DashMap, DashSet};
use std::{
    collections::HashMap,
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
    workspaces: Arc<HashMap<WorkspaceId, Arc<WorkspaceRuntime>>>,
    pub open_files: Arc<DashMap<(WorkspaceId, FileId), Arc<DocumentActor>>>,
    pub terminals: Arc<DashMap<TerminalId, Arc<TerminalActor>>>,
    pub lsp_servers: Arc<DashMap<(WorkspaceId, LanguageId), Arc<LspServerActor>>>,
    pub clients: Arc<DashMap<ClientId, ClientConnectionHandle>>,
    /// Stable only for this websocket connection. A reconnect may reuse the
    /// same client id, so cleanup must also match this identity.
    next_connection_id: Arc<AtomicU64>,
}

#[derive(Debug)]
pub struct WorkspaceRuntime {
    pub id: WorkspaceId,
    pub name: String,
    root: PathBuf,
    pub(crate) fs_mutation_lock: AsyncMutex<()>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let workspaces = config
            .workspaces
            .iter()
            .map(|workspace| {
                (
                    workspace.id.clone(),
                    Arc::new(WorkspaceRuntime {
                        id: workspace.id.clone(),
                        name: workspace.name.clone(),
                        root: workspace.root.clone(),
                        fs_mutation_lock: AsyncMutex::new(()),
                    }),
                )
            })
            .collect();
        Self {
            config: Arc::new(config),
            workspaces: Arc::new(workspaces),
            open_files: Arc::new(DashMap::new()),
            terminals: Arc::new(DashMap::new()),
            lsp_servers: Arc::new(DashMap::new()),
            clients: Arc::new(DashMap::new()),
            next_connection_id: Arc::new(AtomicU64::new(1)),
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
    pub fn base_to_absolute_path(base: &Path, relative: &Path) -> anyhow::Result<PathBuf> {
        let normalized = crate::utils::workspace_path::normalize_workspace_relative(relative)?;
        Ok(base.join(normalized))
    }

    pub fn workspace(&self, workspace_id: &WorkspaceId) -> anyhow::Result<Arc<WorkspaceRuntime>> {
        self.workspaces
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("unknown workspace id: {workspace_id}"))
    }

    pub fn workspace_root(&self, workspace_id: &WorkspaceId) -> anyhow::Result<PathBuf> {
        Ok(self.workspace(workspace_id)?.root.clone())
    }

    pub fn resolve_file_path(
        &self,
        workspace_id: &WorkspaceId,
        file_id: &FileId,
    ) -> anyhow::Result<PathBuf> {
        let root = self.workspace_root(workspace_id)?;
        let candidate = Self::base_to_absolute_path(&root, &PathBuf::from(file_id))?;
        // Existing targets (including symlinks) must canonicalize beneath the
        // configured root. For create paths, validate the nearest existing
        // ancestor so a symlinked parent cannot escape the workspace.
        let mut existing = candidate.as_path();
        while !existing.exists() {
            existing = existing
                .parent()
                .ok_or_else(|| anyhow::anyhow!("path has no existing workspace ancestor"))?;
        }
        let canonical = existing.canonicalize()?;
        if !canonical.starts_with(&root) {
            anyhow::bail!("path resolves outside workspace {workspace_id}");
        }
        Ok(candidate)
    }

    pub fn reverse_resolve_file_path(
        &self,
        workspace_id: &WorkspaceId,
        path: &Path,
    ) -> anyhow::Result<FileId> {
        let root = self.workspace_root(workspace_id)?;
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| anyhow::anyhow!("path is outside workspace {workspace_id}"))?;
        Ok(format!(
            "/{}",
            relative.to_string_lossy().replace('\\', "/")
        ))
    }

    pub fn authorize(
        &self,
        _client_id: &ClientId,
        workspace_id: &WorkspaceId,
    ) -> anyhow::Result<bool> {
        self.workspace(workspace_id).map(|_| true)
    }
}

#[cfg(test)]
mod tests {
    use super::AppState;
    use crate::config::{Config, EnvironmentConfig, WorkspaceConfig};
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

    #[test]
    fn identical_file_ids_resolve_independently_and_unknown_ids_fail() {
        let parent = std::env::temp_dir().join(format!("forge-state-{}", std::process::id()));
        let one = parent.join("one");
        let two = parent.join("two");
        std::fs::create_dir_all(one.join("src")).unwrap();
        std::fs::create_dir_all(two.join("src")).unwrap();
        let one = one.canonicalize().unwrap();
        let two = two.canonicalize().unwrap();
        let state = AppState::new(Config {
            port: 0,
            environment: EnvironmentConfig {
                id: "test".into(),
                name: "Test".into(),
            },
            workspaces: vec![
                WorkspaceConfig {
                    id: "one".into(),
                    name: "One".into(),
                    root: one.clone(),
                },
                WorkspaceConfig {
                    id: "two".into(),
                    name: "Two".into(),
                    root: two.clone(),
                },
            ],
            default_workspace_id: "one".into(),
        });
        assert_eq!(
            state
                .resolve_file_path(&"one".into(), &"/src/main.rs".into())
                .unwrap(),
            one.join("src/main.rs")
        );
        assert_eq!(
            state
                .resolve_file_path(&"two".into(), &"/src/main.rs".into())
                .unwrap(),
            two.join("src/main.rs")
        );
        assert!(
            state
                .resolve_file_path(&"missing".into(), &"/src/main.rs".into())
                .is_err()
        );
        std::fs::remove_dir_all(parent).unwrap();
    }
}
