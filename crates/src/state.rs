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
    actors::{AiSessionActor, DocumentActor, LspServerActor, TerminalActor},
    config::Config,
    models::{ClientId, FileId, LanguageId, ServerMessage, TerminalId, WorkspaceId},
    services::ai_session::AiSessionService,
};

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    workspaces: Arc<HashMap<WorkspaceId, Arc<WorkspaceRuntime>>>,
    pub open_files: Arc<DashMap<(WorkspaceId, FileId), Arc<DocumentActor>>>,
    pub terminals: Arc<DashMap<TerminalId, TerminalRecord>>,
    pub ai_sessions: Arc<AiSessionService>,
    ai_session_actors: Arc<DashMap<String, Arc<AiSessionActor>>>,
    pub lsp_servers: Arc<DashMap<(WorkspaceId, LanguageId), Arc<LspServerActor>>>,
    pub clients: Arc<DashMap<ClientId, ClientConnectionHandle>>,
    pub debug: crate::debug::DebugService,
    /// Stable only for this websocket connection. A reconnect may reuse the
    /// same client id, so cleanup must also match this identity.
    next_connection_id: Arc<AtomicU64>,
}

#[derive(Debug, Clone)]
pub struct TerminalRecord {
    pub workspace_id: WorkspaceId,
    pub owner: ClientId,
    pub profile_id: String,
    pub title: Arc<std::sync::RwLock<String>>,
    pub actor: Arc<TerminalActor>,
    pub terminating: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Debug)]
pub struct WorkspaceRuntime {
    pub id: WorkspaceId,
    pub name: String,
    root: PathBuf,
    pub(crate) fs_mutation_lock: AsyncMutex<()>,
    pub(crate) git_mutation_lock: AsyncMutex<()>,
    pub(crate) git_generation: AtomicU64,
    pub(crate) git_available: bool,
    pub(crate) git_repository_present: bool,
    pub(crate) git_identity_configured: bool,
}

impl AppState {
    pub fn new(config: Config) -> anyhow::Result<Self> {
        let workspaces = config
            .workspaces
            .iter()
            .map(|workspace| {
                let git_available = std::process::Command::new("git")
                    .arg("--version")
                    .output()
                    .is_ok_and(|output| output.status.success());
                let git_configured = |key: &str| {
                    std::process::Command::new("git")
                        .current_dir(&workspace.root)
                        .args(["config", "--get", key])
                        .env("GIT_TERMINAL_PROMPT", "0")
                        .output()
                        .is_ok_and(|output| output.status.success() && !output.stdout.is_empty())
                };
                let git_repository_present = std::process::Command::new("git")
                    .current_dir(&workspace.root)
                    .args(["rev-parse", "--show-toplevel"])
                    .env("GIT_TERMINAL_PROMPT", "0")
                    .output()
                    .ok()
                    .filter(|output| output.status.success())
                    .and_then(|output| String::from_utf8(output.stdout).ok())
                    .and_then(|path| std::path::PathBuf::from(path.trim()).canonicalize().ok())
                    .is_some_and(|root| root == workspace.root);
                (
                    workspace.id.clone(),
                    Arc::new(WorkspaceRuntime {
                        id: workspace.id.clone(),
                        name: workspace.name.clone(),
                        root: workspace.root.clone(),
                        fs_mutation_lock: AsyncMutex::new(()),
                        git_mutation_lock: AsyncMutex::new(()),
                        git_generation: AtomicU64::new(1),
                        git_available,
                        git_repository_present,
                        git_identity_configured: git_configured("user.name")
                            && git_configured("user.email"),
                    }),
                )
            })
            .collect();
        let ai_sessions = Arc::new(AiSessionService::new(
            config.agent_sessions_dir.clone(),
            config.openai_compatible.clone(),
        )?);
        let state = Self {
            config: Arc::new(config),
            workspaces: Arc::new(workspaces),
            open_files: Arc::new(DashMap::new()),
            terminals: Arc::new(DashMap::new()),
            ai_sessions,
            ai_session_actors: Arc::new(DashMap::new()),
            lsp_servers: Arc::new(DashMap::new()),
            clients: Arc::new(DashMap::new()),
            debug: crate::debug::DebugService::new(),
            next_connection_id: Arc::new(AtomicU64::new(1)),
        };
        // The session service has already replayed every JSONL file. Claim
        // unfinished operations immediately so a browser disconnect (or no
        // browser at all) never owns execution lifetime.
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            for summary in state.ai_sessions.list(None) {
                let actor = state.ai_session(summary.metadata.id);
                runtime.spawn(async move {
                    if actor.recover().await.is_err() {
                        tracing::error!("could not start durable AI session recovery actor");
                    }
                });
            }
        } else {
            tracing::warn!("AI session recovery deferred because no Tokio runtime is active");
        }
        Ok(state)
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

    pub fn ai_session(&self, session_id: String) -> Arc<AiSessionActor> {
        self.ai_session_actors
            .entry(session_id.clone())
            .or_insert_with(|| {
                AiSessionActor::spawn(
                    session_id,
                    self.config.openai_compatible.clone(),
                    self.ai_sessions.clone(),
                    self.agent_tool_context(),
                )
            })
            .clone()
    }

    fn agent_tool_context(&self) -> crate::agent::tools::ToolContext {
        crate::agent::tools::ToolContext::new(
            self.config
                .workspaces
                .iter()
                .map(|workspace| (workspace.id.clone(), workspace.root.clone()))
                .collect(),
            self.open_files.clone(),
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
        std::fs::create_dir_all(parent.join("sessions")).unwrap();
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
            openai_compatible: None,
            agent_sessions_dir: parent.join("sessions"),
        })
        .unwrap();
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
