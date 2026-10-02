// write.rs

use std::{future::Future, path::PathBuf, pin::Pin, time::Duration};

use serde::Deserialize;
use serde_json::json;

use super::{AgentTool, ToolCancellation, ToolContext, ToolDescriptor, ToolResult};

pub struct WriteTool;

#[derive(Deserialize)]
struct WriteArguments {
    path: String,
    content: String,
}

impl AgentTool for WriteTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            name: "write",
            description: "Create a new text file in a configured Forge workspace. Fails if the file already exists.",
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["path", "content"],
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path."
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete contents of the new file."
                    }
                }
            }),
            timeout: Duration::from_secs(15),
            max_attempts: 1,
            replay_class: crate::agent::operation::ToolReplayClass::Never,
            requires_confirmation: false,
        }
    }

    fn execute<'a>(
        &'a self,
        context: ToolContext,
        arguments: serde_json::Value,
        cancellation: ToolCancellation,
    ) -> Pin<Box<dyn Future<Output = ToolResult> + Send + 'a>> {
        Box::pin(async move {
            if cancellation.is_cancelled() {
                return failure("Tool execution cancelled".into());
            }

            let arguments = match serde_json::from_value::<WriteArguments>(arguments) {
                Ok(arguments) => arguments,
                Err(error) => {
                    return failure(format!("Invalid write arguments: {error}"));
                }
            };

            let relative = match crate::utils::workspace_path::normalize_workspace_relative(
                PathBuf::from(&arguments.path).as_path(),
            ) {
                Ok(path) if !path.as_os_str().is_empty() => path,
                Ok(_) => return failure("A file path is required".into()),
                Err(error) => return failure(format!("Invalid path: {error}")),
            };

            for (_, root) in context.workspaces() {
                if cancellation.is_cancelled() {
                    return failure("Tool execution cancelled".into());
                }

                let path = root.join(&relative);

                if path.exists() {
                    return failure("File already exists. Use the edit tool instead.".into());
                }

                let Some(parent) = path.parent() else {
                    return failure("Invalid file path".into());
                };

                let canonical_parent = match parent.canonicalize() {
                    Ok(path) if path.starts_with(&root) => path,
                    Ok(_) => return failure("Path resolves outside the workspace".into()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        return failure("Parent directory does not exist".into());
                    }
                    Err(error) => {
                        return failure(format!("Could not resolve parent directory: {error}"));
                    }
                };

                let file_name = match path.file_name() {
                    Some(file_name) => file_name,
                    None => return failure("Invalid file path".into()),
                };

                let path = canonical_parent.join(file_name);

                if cancellation.is_cancelled() {
                    return failure("Tool execution cancelled".into());
                }

                if let Err(error) = tokio::fs::write(&path, &arguments.content).await {
                    return failure(format!("Could not write file: {error}"));
                }

                return ToolResult {
                    content: json!({
                        "path": arguments.path,
                        "bytes_written": arguments.content.len(),
                        "created_lines": arguments.content.lines().take(10).collect::<Vec<_>>(),
                        "created_line_count": arguments.content.lines().count()
                    })
                    .to_string(),
                    is_error: false,
                    failure_code: None,
                    retry_failures: Vec::new(),
                };
            }

            failure("File path is not inside a configured project".into())
        })
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

    use super::super::{AgentTool, ToolCancellation, ToolContext};
    use super::*;

    #[tokio::test]
    async fn creates_a_new_file_in_a_configured_workspace() {
        let root = std::env::temp_dir().join(format!("forge-write-tool-{}", uuid::Uuid::new_v4()));

        tokio::fs::create_dir_all(&root).await.unwrap();

        let root = root.canonicalize().unwrap();

        let context = ToolContext::new(
            HashMap::from([("workspace".into(), root.clone())]),
            Arc::new(DashMap::new()),
            root.clone(),
        );

        let result = WriteTool
            .execute(
                context,
                serde_json::json!({
                    "path": "notes.txt",
                    "content": "hello from Forge"
                }),
                ToolCancellation::default(),
            )
            .await;

        assert!(!result.is_error);

        let content = tokio::fs::read_to_string(root.join("notes.txt"))
            .await
            .unwrap();

        assert_eq!(content, "hello from Forge");

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn refuses_to_overwrite_an_existing_file() {
        let root = std::env::temp_dir().join(format!("forge-write-tool-{}", uuid::Uuid::new_v4()));

        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(root.join("notes.txt"), "existing")
            .await
            .unwrap();

        let root = root.canonicalize().unwrap();

        let context = ToolContext::new(
            HashMap::from([("workspace".into(), root.clone())]),
            Arc::new(DashMap::new()),
            root.clone(),
        );

        let result = WriteTool
            .execute(
                context,
                serde_json::json!({
                    "path": "notes.txt",
                    "content": "replacement"
                }),
                ToolCancellation::default(),
            )
            .await;

        assert!(result.is_error);

        let content = tokio::fs::read_to_string(root.join("notes.txt"))
            .await
            .unwrap();

        assert_eq!(content, "existing");

        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
