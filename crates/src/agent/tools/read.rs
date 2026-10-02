use std::{future::Future, path::PathBuf, pin::Pin, time::Duration};

use serde::Deserialize;
use serde_json::json;

use super::{AgentTool, MAX_TOOL_RESULT_BYTES, ToolCancellation, ToolContext, ToolDescriptor, ToolResult};

pub struct ReadTool;

#[derive(Deserialize)]
struct ReadArguments {
    path: String,
}

impl AgentTool for ReadTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            name: "read",
            description: "Read a text file from a configured Forge workspace.",
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "Workspace-relative path." }
                }
            }),
            timeout: Duration::from_secs(15),
            max_attempts: 2,
            replay_class: crate::agent::operation::ToolReplayClass::Safe,
        }
    }

    fn execute<'a>(
        &'a self,
        context: ToolContext,
        arguments: serde_json::Value,
        cancellation: ToolCancellation,
    ) -> Pin<Box<dyn Future<Output = ToolResult> + Send + 'a>> {
        Box::pin(async move {
            if cancellation.is_cancelled() { return failure("Tool execution cancelled".into()); }
            let arguments = match serde_json::from_value::<ReadArguments>(arguments) {
                Ok(arguments) => arguments,
                Err(error) => return failure(format!("Invalid read arguments: {error}")),
            };
            let relative = match crate::utils::workspace_path::normalize_workspace_relative(
                PathBuf::from(&arguments.path).as_path(),
            ) {
                Ok(path) if !path.as_os_str().is_empty() => path,
                Ok(_) => return failure("A file path is required".into()),
                Err(error) => return failure(format!("Invalid path: {error}")),
            };
            let file_id = format!("/{}", relative.to_string_lossy().replace('\\', "/"));
            if let Some(document) = context.open_document(&file_id) {
                let content = document.content().await;
                return success(content, "open_document");
            }
            for (_, root) in context.workspaces() {
                if cancellation.is_cancelled() { return failure("Tool execution cancelled".into()); }
                let path = root.join(&relative);
                let canonical = match path.canonicalize() {
                    Ok(path) if path.starts_with(&root) => path,
                    Ok(_) => return failure("Path resolves outside the workspace".into()),
                    Err(_) => continue,
                };
                let content = match tokio::fs::read_to_string(canonical).await {
                    Ok(content) => content,
                    Err(error) => return failure(format!("Could not read file: {error}")),
                };
                return success(content, "disk");
            }
            failure("File was not found in the configured project".into())
        })
    }
}

fn success(mut content: String, source: &str) -> ToolResult {
    let truncated = content.len() > MAX_TOOL_RESULT_BYTES;
    if truncated {
        content.truncate(MAX_TOOL_RESULT_BYTES);
    }
    ToolResult {
        content: json!({ "source": source, "truncated": truncated, "content": content })
            .to_string(),
        is_error: false,
        failure_code: None,
        retry_failures: Vec::new(),
    }
}

fn failure(message: String) -> ToolResult {
    ToolResult {
        content: json!({ "error": message }).to_string(),
        is_error: true,
        failure_code: Some(crate::agent::error::AgentFailureCode::ToolExecutionFailed),
        retry_failures: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Arc};

    use dashmap::DashMap;

    use super::super::{AgentTool, ReadTool, ToolContext};

    #[tokio::test]
    async fn reads_a_file_only_from_a_configured_workspace() {
        let root = std::env::temp_dir().join(format!("forge-read-tool-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(root.join("notes.txt"), "hello from Forge")
            .await
            .unwrap();
        let root = root.canonicalize().unwrap();
        let context = ToolContext::new(
            HashMap::from([("workspace".into(), root.clone())]),
            Arc::new(DashMap::new()),
        );
        let result = ReadTool
            .execute(context, serde_json::json!({ "path": "notes.txt" }), super::super::ToolCancellation::default())
            .await;
        assert!(!result.is_error);
        assert!(result.content.contains("hello from Forge"));
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
