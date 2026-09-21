mod find;
mod grep;
mod read;

use std::{collections::HashMap, future::Future, pin::Pin, sync::{atomic::{AtomicBool, Ordering}, Arc}, time::Duration};

use dashmap::DashMap;
use serde_json::Value;

use crate::{agent::error::AgentFailureCode, models::{FileId, WorkspaceId}};

pub use {find::FindTool, grep::GrepTool, read::ReadTool};

pub const MAX_TOOL_RESULT_BYTES: usize = 32_000;

#[derive(Clone, Debug)]
pub struct ToolDescriptor {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
    /// Upper bound for one invocation. Tools must remain independently
    /// cancellable because a session stop must not wait on arbitrary I/O.
    pub timeout: Duration,
    /// Read-only tools are safe to retry after transient errors. Mutating
    /// tools will opt in explicitly when they are added.
    pub max_attempts: u32,
}

#[derive(Clone)]
pub struct ToolContext {
    workspace_roots: Arc<HashMap<WorkspaceId, std::path::PathBuf>>,
    open_files: Arc<DashMap<(WorkspaceId, FileId), Arc<crate::actors::DocumentActor>>>,
}

impl ToolContext {
    pub fn new(
        workspace_roots: HashMap<WorkspaceId, std::path::PathBuf>,
        open_files: Arc<DashMap<(WorkspaceId, FileId), Arc<crate::actors::DocumentActor>>>,
    ) -> Self {
        Self {
            workspace_roots: Arc::new(workspace_roots),
            open_files,
        }
    }

    pub(crate) fn workspaces(&self) -> Vec<(WorkspaceId, std::path::PathBuf)> {
        self.workspace_roots
            .iter()
            .map(|(workspace_id, root)| (workspace_id.clone(), root.clone()))
            .collect()
    }

    pub(crate) fn open_document(&self, file_id: &str) -> Option<Arc<crate::actors::DocumentActor>> {
        self.open_files
            .iter()
            .find(|entry| entry.key().1 == file_id)
            .map(|entry| entry.value().clone())
    }
}

#[derive(Clone, Debug)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
    pub failure_code: Option<AgentFailureCode>,
    /// Failed attempts retained even when a later retry succeeds. The session
    /// owner persists these as diagnostic events.
    pub retry_failures: Vec<ToolRetryFailure>,
}

#[derive(Clone, Debug)]
pub struct ToolRetryFailure {
    pub attempt: u32,
    pub code: AgentFailureCode,
    pub detail: String,
}

#[derive(Clone, Default)]
pub struct ToolCancellation(Arc<AtomicBool>);

impl ToolCancellation {
    pub fn cancel(&self) { self.0.store(true, Ordering::Release); }
    pub fn is_cancelled(&self) -> bool { self.0.load(Ordering::Acquire) }
    pub fn flag(&self) -> Arc<AtomicBool> { Arc::clone(&self.0) }
}

#[cfg(test)]
mod tests {
    use super::ToolCancellation;

    #[test]
    fn cancellation_is_shared_by_tool_work() {
        let cancellation = ToolCancellation::default();
        assert!(!cancellation.is_cancelled());
        cancellation.clone().cancel();
        assert!(cancellation.is_cancelled());
    }
}

pub trait AgentTool: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;

    fn execute<'a>(
        &'a self,
        context: ToolContext,
        arguments: Value,
        cancellation: ToolCancellation,
    ) -> Pin<Box<dyn Future<Output = ToolResult> + Send + 'a>>;
}

#[derive(Clone, Default)]
pub struct ToolRegistry {
    tools: Arc<HashMap<&'static str, Arc<dyn AgentTool>>>,
}

impl ToolRegistry {
    pub fn read_only() -> Self {
        let read: Arc<dyn AgentTool> = Arc::new(ReadTool);
        let find: Arc<dyn AgentTool> = Arc::new(FindTool);
        let grep: Arc<dyn AgentTool> = Arc::new(GrepTool);
        Self {
            tools: Arc::from(HashMap::from([
                (read.descriptor().name, read),
                (find.descriptor().name, find),
                (grep.descriptor().name, grep),
            ])),
        }
    }

    pub fn definitions(&self) -> Vec<crate::models::OpenAiToolDefinition> {
        self.tools
            .values()
            .map(|tool| {
                let descriptor = tool.descriptor();
                crate::models::OpenAiToolDefinition {
                    kind: "function",
                    function: crate::models::OpenAiToolFunction {
                        name: descriptor.name.to_owned(),
                        description: descriptor.description.to_owned(),
                        parameters: descriptor.parameters,
                    },
                }
            })
            .collect()
    }

    pub async fn execute(&self, context: ToolContext, name: &str, arguments: Value, cancellation: ToolCancellation) -> ToolResult {
        let Some(tool) = self.tools.get(name) else {
            return ToolResult {
                content: format!("Unknown tool: {name}"),
                is_error: true,
                failure_code: Some(AgentFailureCode::ToolExecutionFailed),
                retry_failures: Vec::new(),
            };
        };
        let descriptor = tool.descriptor();
        let mut last_error = None;
        let mut retry_failures = Vec::new();
        for attempt in 1..=descriptor.max_attempts.max(1) {
            if cancellation.is_cancelled() {
                return ToolResult { content: "Tool execution cancelled".into(), is_error: true, failure_code: Some(AgentFailureCode::ToolCancelled), retry_failures };
            }
            let result = tokio::time::timeout(descriptor.timeout, tool.execute(context.clone(), arguments.clone(), cancellation.clone())).await;
            let result = match result {
                Ok(result) => result,
                Err(_) => ToolResult { content: format!("Tool timed out after {} seconds", descriptor.timeout.as_secs()), is_error: true, failure_code: Some(AgentFailureCode::ToolTimedOut), retry_failures: Vec::new() },
            };
            if !result.is_error || attempt == descriptor.max_attempts.max(1) || cancellation.is_cancelled() {
                return ToolResult { retry_failures, ..result };
            }
            let detail = result.content;
            retry_failures.push(ToolRetryFailure { attempt, code: result.failure_code.unwrap_or(AgentFailureCode::ToolExecutionFailed), detail: detail.clone() });
            last_error = Some(detail);
            tracing::warn!(tool = descriptor.name, attempt, "retrying failed agent tool call");
        }
        ToolResult { content: last_error.unwrap_or_else(|| "Tool execution failed".into()), is_error: true, failure_code: Some(AgentFailureCode::ToolExecutionFailed), retry_failures }
    }
}
