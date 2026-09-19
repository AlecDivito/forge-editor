use super::{
    ConfigurationList, CreateSession, SessionSnapshot, SessionState, config, strategy_for,
};
use crate::{actors::DebugSessionActor, config::DebugAdapterConfig, models::WorkspaceId};
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::watch;
use uuid::Uuid;

/// Application-facing debug API: configuration discovery and session lookup.
///
/// Each session's process and DAP lifecycle belongs to a `DebugSessionActor`.
#[derive(Debug, Clone)]
pub struct DebugService {
    sessions: Arc<DashMap<String, Arc<DebugSessionActor>>>,
    adapter: DebugAdapterConfig,
}

impl DebugService {
    pub fn new(adapter: DebugAdapterConfig) -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            adapter,
        }
    }

    pub async fn configurations(
        &self,
        root: &std::path::Path,
        workspace: &WorkspaceId,
    ) -> anyhow::Result<ConfigurationList> {
        Ok(config::ConfigurationLoader::new(root, workspace)
            .load()
            .await?
            .public)
    }

    pub async fn create(
        &self,
        root: &std::path::Path,
        workspace: &WorkspaceId,
        request: CreateSession,
    ) -> anyhow::Result<SessionSnapshot> {
        if request
            .active_file_id
            .as_deref()
            .is_some_and(|path| path.contains(".."))
        {
            anyhow::bail!("activeFileId is invalid");
        }
        let loaded = config::ConfigurationLoader::new(root, workspace)
            .load()
            .await?;
        if loaded.public.revision != request.configuration_revision {
            anyhow::bail!("stale configuration revision");
        }
        let configuration = loaded
            .resolved
            .get(&request.configuration_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("configuration is missing or invalid"))?;
        let strategy = strategy_for(&configuration.adapter_type)
            .ok_or_else(|| anyhow::anyhow!("debug adapter strategy is unavailable"))?;

        let actors = self
            .sessions
            .iter()
            .map(|entry| entry.value().clone())
            .collect::<Vec<_>>();
        let mut active_sessions = 0;
        for actor in actors {
            if actor.workspace_id() == workspace && actor.is_active().await {
                active_sessions += 1;
            }
        }
        if active_sessions >= 2 {
            anyhow::bail!("workspace debug session limit reached");
        }

        let session_id = Uuid::new_v4().to_string();
        let snapshot = SessionSnapshot {
            session_id: session_id.clone(),
            workspace_id: workspace.clone(),
            configuration_id: configuration.id.clone(),
            configuration_name: configuration.name.clone(),
            state: SessionState::Creating,
            event_cursor: 0,
            output: vec![],
            exit_code: None,
            error: None,
            capabilities: strategy.capabilities(),
        };
        let actor = DebugSessionActor::spawn(
            snapshot.clone(),
            configuration,
            strategy,
            self.adapter.clone(),
        );
        self.sessions.insert(session_id, actor);
        Ok(snapshot)
    }

    pub async fn get(
        &self,
        workspace: &WorkspaceId,
        session: &str,
    ) -> anyhow::Result<SessionSnapshot> {
        let actor = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug session not found"))?
            .clone();
        actor.snapshot(workspace).await
    }

    pub fn subscribe(
        &self,
        workspace: &WorkspaceId,
        session: &str,
    ) -> anyhow::Result<watch::Receiver<SessionSnapshot>> {
        let actor = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug session not found"))?
            .clone();
        actor.subscribe(workspace)
    }

    pub async fn stop(
        &self,
        workspace: &WorkspaceId,
        session: &str,
    ) -> anyhow::Result<SessionSnapshot> {
        let actor = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug session not found"))?
            .clone();
        actor.stop(workspace).await
    }
}
