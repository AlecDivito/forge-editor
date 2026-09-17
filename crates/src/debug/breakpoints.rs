use super::{
    BreakpointList, CreateBreakpoint, RequestedSourceBreakpoint, UpdateBreakpoint, limits,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::{Mutex, broadcast};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct BreakpointIntentChanged {
    pub workspace_id: String,
    pub file_id: String,
    pub revision: u64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct WorkspaceBreakpoints {
    #[serde(default = "schema_version")]
    schema_version: u32,
    revision: u64,
    items: HashMap<String, RequestedSourceBreakpoint>,
}
fn schema_version() -> u32 {
    1
}

fn storage_key(workspace: &str) -> String {
    let mut key = String::with_capacity(3 + workspace.len() * 2);
    key.push_str("ws-");
    for byte in workspace.as_bytes() {
        use std::fmt::Write;
        let _ = write!(key, "{byte:02x}");
    }
    key
}

/// Atomic, revision-fenced repository for shared workspace breakpoint intent.
#[derive(Debug, Clone)]
pub struct BreakpointRepository {
    workspaces: Arc<DashMap<String, Arc<Mutex<WorkspaceBreakpoints>>>>,
    changes: broadcast::Sender<BreakpointIntentChanged>,
    data_dir: Option<Arc<PathBuf>>,
}

impl Default for BreakpointRepository {
    fn default() -> Self {
        let (changes, _) = broadcast::channel(256);
        Self {
            workspaces: Arc::new(DashMap::new()),
            changes,
            data_dir: None,
        }
    }
}

impl BreakpointRepository {
    pub fn persistent(data_dir: PathBuf) -> Self {
        let mut repository = Self::default();
        repository.data_dir = Some(Arc::new(data_dir));
        repository
    }
    fn workspace(&self, id: &str) -> Arc<Mutex<WorkspaceBreakpoints>> {
        self.workspaces
            .entry(id.to_owned())
            .or_insert_with(|| {
                let loaded = self
                    .data_dir
                    .as_ref()
                    .and_then(|dir| {
                        let encoded = dir.join(format!("{}.json", storage_key(id)));
                        std::fs::read(encoded).ok().or_else(|| {
                            id.chars()
                                .all(|character| {
                                    character.is_ascii_alphanumeric() || "-_".contains(character)
                                })
                                .then(|| std::fs::read(dir.join(format!("{id}.json"))).ok())
                                .flatten()
                        })
                    })
                    .and_then(|bytes| serde_json::from_slice::<WorkspaceBreakpoints>(&bytes).ok())
                    .filter(|state| state.schema_version == 1)
                    .unwrap_or_else(|| WorkspaceBreakpoints {
                        schema_version: 1,
                        ..Default::default()
                    });
                Arc::new(Mutex::new(loaded))
            })
            .clone()
    }
    async fn persist(&self, workspace: &str, state: &WorkspaceBreakpoints) -> anyhow::Result<()> {
        let Some(dir) = &self.data_dir else {
            return Ok(());
        };
        tokio::fs::create_dir_all(dir.as_ref()).await?;
        let key = storage_key(workspace);
        let target = dir.join(format!("{key}.json"));
        let temporary = dir.join(format!(".{key}.{}.tmp", Uuid::new_v4()));
        let bytes = serde_json::to_vec(state)?;
        tokio::fs::write(&temporary, bytes).await?;
        if let Err(error) = tokio::fs::rename(&temporary, &target).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error.into());
        }
        Ok(())
    }
    pub fn subscribe(&self) -> broadcast::Receiver<BreakpointIntentChanged> {
        self.changes.subscribe()
    }
    pub async fn list(&self, workspace: &str) -> BreakpointList {
        let state = self.workspace(workspace);
        let state = state.lock().await;
        let mut breakpoints = state.items.values().cloned().collect::<Vec<_>>();
        breakpoints.sort_by(|a, b| {
            (&a.file_id, a.line, a.column, &a.breakpoint_id).cmp(&(
                &b.file_id,
                b.line,
                b.column,
                &b.breakpoint_id,
            ))
        });
        BreakpointList {
            schema_version: 1,
            revision: state.revision,
            breakpoints,
        }
    }
    pub async fn get(&self, workspace: &str, id: &str) -> Option<RequestedSourceBreakpoint> {
        self.workspace(workspace)
            .lock()
            .await
            .items
            .get(id)
            .cloned()
    }
    pub async fn create(
        &self,
        workspace: &str,
        value: CreateBreakpoint,
    ) -> anyhow::Result<RequestedSourceBreakpoint> {
        validate(
            value.condition.as_ref(),
            value.hit_condition.as_ref(),
            value.log_message.as_ref(),
        )?;
        if value.file_id.contains("..") {
            anyhow::bail!("invalid breakpoint source")
        }
        let state = self.workspace(workspace);
        let mut state = state.lock().await;
        if state.items.len() >= limits::MAX_BREAKPOINTS_PER_WORKSPACE {
            anyhow::bail!("debug_result_too_large")
        }
        if state
            .items
            .values()
            .filter(|b| b.file_id == value.file_id)
            .count()
            >= limits::MAX_BREAKPOINTS_PER_SOURCE
        {
            anyhow::bail!("debug_result_too_large")
        }
        state.revision += 1;
        let item = RequestedSourceBreakpoint {
            breakpoint_id: Uuid::new_v4().to_string(),
            workspace_id: workspace.into(),
            file_id: value.file_id,
            line: value.line,
            column: value.column,
            enabled: value.enabled,
            condition: value.condition,
            hit_condition: value.hit_condition,
            log_message: value.log_message,
            revision: state.revision,
        };
        state.items.insert(item.breakpoint_id.clone(), item.clone());
        if let Err(error) = self.persist(workspace, &state).await {
            state.items.remove(&item.breakpoint_id);
            state.revision -= 1;
            return Err(error);
        }
        let _ = self.changes.send(BreakpointIntentChanged {
            workspace_id: workspace.into(),
            file_id: item.file_id.clone(),
            revision: state.revision,
        });
        Ok(item)
    }
    pub async fn update(
        &self,
        workspace: &str,
        id: &str,
        value: UpdateBreakpoint,
    ) -> anyhow::Result<RequestedSourceBreakpoint> {
        validate(
            value.condition.as_ref().and_then(|x| x.as_ref()),
            value.hit_condition.as_ref().and_then(|x| x.as_ref()),
            value.log_message.as_ref().and_then(|x| x.as_ref()),
        )?;
        let state = self.workspace(workspace);
        let mut state = state.lock().await;
        let before = state.clone();
        let current = state
            .items
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("debug_session_not_found"))?;
        if current.revision != value.expected_revision {
            anyhow::bail!("debug_revision_conflict")
        }
        state.revision += 1;
        let revision = state.revision;
        let item = state.items.get_mut(id).unwrap();
        if let Some(v) = value.line {
            item.line = v
        }
        if let Some(v) = value.column {
            item.column = v
        }
        if let Some(v) = value.enabled {
            item.enabled = v
        }
        if let Some(v) = value.condition {
            item.condition = v
        }
        if let Some(v) = value.hit_condition {
            item.hit_condition = v
        }
        if let Some(v) = value.log_message {
            item.log_message = v
        }
        item.revision = revision;
        let item = item.clone();
        if let Err(error) = self.persist(workspace, &state).await {
            *state = before;
            return Err(error);
        }
        let _ = self.changes.send(BreakpointIntentChanged {
            workspace_id: workspace.into(),
            file_id: item.file_id.clone(),
            revision,
        });
        Ok(item)
    }
    pub async fn delete(&self, workspace: &str, id: &str, expected: u64) -> anyhow::Result<()> {
        let state = self.workspace(workspace);
        let mut state = state.lock().await;
        let before = state.clone();
        let item = state
            .items
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("debug_session_not_found"))?;
        if item.revision != expected {
            anyhow::bail!("debug_revision_conflict")
        }
        let file_id = item.file_id.clone();
        state.items.remove(id);
        state.revision += 1;
        if let Err(error) = self.persist(workspace, &state).await {
            *state = before;
            return Err(error);
        }
        let _ = self.changes.send(BreakpointIntentChanged {
            workspace_id: workspace.into(),
            file_id,
            revision: state.revision,
        });
        Ok(())
    }

    pub async fn rename_source(
        &self,
        workspace: &str,
        from: &str,
        to: &str,
        is_directory: bool,
    ) -> anyhow::Result<()> {
        let state = self.workspace(workspace);
        let mut state = state.lock().await;
        let before = state.clone();
        let mut changed = Vec::new();
        let mut changed_sources = BTreeSet::new();
        for item in state.items.values_mut() {
            let replacement = if item.file_id == from {
                Some(to.to_owned())
            } else if is_directory {
                item.file_id
                    .strip_prefix(&format!("{from}/"))
                    .map(|suffix| format!("{to}/{suffix}"))
            } else {
                None
            };
            if let Some(path) = replacement {
                changed_sources.insert(item.file_id.clone());
                changed_sources.insert(path.clone());
                item.file_id = path;
                changed.push(item.breakpoint_id.clone());
            }
        }
        if changed.is_empty() {
            return Ok(());
        }
        state.revision += 1;
        let revision = state.revision;
        for id in changed {
            state.items.get_mut(&id).unwrap().revision = revision;
        }
        if let Err(error) = self.persist(workspace, &state).await {
            *state = before;
            return Err(error);
        }
        for file_id in changed_sources {
            let _ = self.changes.send(BreakpointIntentChanged {
                workspace_id: workspace.into(),
                file_id,
                revision,
            });
        }
        Ok(())
    }
    pub async fn mark_source_deleted(
        &self,
        workspace: &str,
        path: &str,
        is_directory: bool,
    ) -> anyhow::Result<()> {
        let state = self.workspace(workspace);
        let mut state = state.lock().await;
        let before = state.clone();
        let ids = state
            .items
            .values()
            .filter(|item| {
                item.file_id == path
                    || (is_directory && item.file_id.starts_with(&format!("{path}/")))
            })
            .map(|item| item.breakpoint_id.clone())
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return Ok(());
        }
        state.revision += 1;
        let revision = state.revision;
        for id in ids {
            let item = state.items.get_mut(&id).unwrap();
            item.enabled = false;
            item.revision = revision;
        }
        if let Err(error) = self.persist(workspace, &state).await {
            *state = before;
            return Err(error);
        }
        let affected_sources = state
            .items
            .values()
            .filter(|item| {
                item.file_id == path
                    || (is_directory && item.file_id.starts_with(&format!("{path}/")))
            })
            .map(|item| item.file_id.clone())
            .collect::<BTreeSet<_>>();
        for file_id in affected_sources {
            let _ = self.changes.send(BreakpointIntentChanged {
                workspace_id: workspace.into(),
                file_id,
                revision,
            });
        }
        Ok(())
    }
}

fn validate(
    condition: Option<&String>,
    hit: Option<&String>,
    log: Option<&String>,
) -> anyhow::Result<()> {
    if condition.is_some_and(|v| v.len() > limits::MAX_CONDITION_BYTES)
        || hit.is_some_and(|v| v.len() > limits::MAX_HIT_CONDITION_BYTES)
        || log.is_some_and(|v| v.len() > limits::MAX_LOG_MESSAGE_BYTES)
    {
        anyhow::bail!("debug_result_too_large")
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn revisions_prevent_lost_updates() {
        let repo = BreakpointRepository::default();
        let b = repo
            .create(
                "w",
                CreateBreakpoint {
                    file_id: "/a.rs".into(),
                    line: 0,
                    column: None,
                    enabled: true,
                    condition: None,
                    hit_condition: None,
                    log_message: None,
                },
            )
            .await
            .unwrap();
        let update = || UpdateBreakpoint {
            expected_revision: b.revision,
            line: Some(2),
            column: None,
            enabled: None,
            condition: None,
            hit_condition: None,
            log_message: None,
        };
        assert!(repo.update("w", &b.breakpoint_id, update()).await.is_ok());
        assert!(repo.update("w", &b.breakpoint_id, update()).await.is_err());
    }
    #[tokio::test]
    async fn persistent_repository_recovers_and_reconciles_sources() {
        let dir = std::env::temp_dir().join(format!("forge-breakpoints-{}", Uuid::new_v4()));
        let repository = BreakpointRepository::persistent(dir.clone());
        let item = repository
            .create(
                "workspace",
                CreateBreakpoint {
                    file_id: "/src/main.rs".into(),
                    line: 4,
                    column: None,
                    enabled: true,
                    condition: None,
                    hit_condition: None,
                    log_message: None,
                },
            )
            .await
            .unwrap();
        drop(repository);
        let repository = BreakpointRepository::persistent(dir.clone());
        assert_eq!(
            repository.list("workspace").await.breakpoints[0].breakpoint_id,
            item.breakpoint_id
        );
        repository
            .rename_source("workspace", "/src", "/source", true)
            .await
            .unwrap();
        assert_eq!(
            repository.list("workspace").await.breakpoints[0].file_id,
            "/source/main.rs"
        );
        repository
            .mark_source_deleted("workspace", "/source/main.rs", false)
            .await
            .unwrap();
        assert!(!repository.list("workspace").await.breakpoints[0].enabled);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
