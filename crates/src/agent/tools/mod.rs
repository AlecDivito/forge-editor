mod find;
mod grep;
mod read;

use std::{collections::HashMap, future::Future, pin::Pin, sync::Arc};

use dashmap::DashMap;
use serde_json::Value;

use crate::models::{FileId, WorkspaceId};

pub use {find::FindTool, grep::GrepTool, read::ReadTool};

pub const MAX_TOOL_RESULT_BYTES: usize = 32_000;

#[derive(Clone, Debug)]
pub struct ToolDescriptor {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
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
}

pub trait AgentTool: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;

    fn execute<'a>(
        &'a self,
        context: ToolContext,
        arguments: Value,
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

    pub async fn execute(&self, context: ToolContext, name: &str, arguments: Value) -> ToolResult {
        let Some(tool) = self.tools.get(name) else {
            return ToolResult {
                content: format!("Unknown tool: {name}"),
                is_error: true,
            };
        };
        tool.execute(context, arguments).await
    }
}
