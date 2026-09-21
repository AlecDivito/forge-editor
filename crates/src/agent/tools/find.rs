use std::{future::Future, pin::Pin, time::Duration};

use serde::Deserialize;
use serde_json::json;

use super::{AgentTool, ToolCancellation, ToolContext, ToolDescriptor, ToolResult};

pub struct FindTool;

#[derive(Deserialize)]
struct FindArguments {
    query: String,
}

impl AgentTool for FindTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            name: "find",
            description: "Find files by fuzzy name or path across the configured Forge project.",
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["query"],
                "properties": { "query": { "type": "string" } }
            }),
            timeout: Duration::from_secs(15),
            max_attempts: 2,
        }
    }

    fn execute<'a>(
        &'a self,
        context: ToolContext,
        arguments: serde_json::Value,
        cancellation: ToolCancellation,
    ) -> Pin<Box<dyn Future<Output = ToolResult> + Send + 'a>> {
        Box::pin(async move {
            let arguments = match serde_json::from_value::<FindArguments>(arguments) {
                Ok(arguments) if !arguments.query.trim().is_empty() => arguments,
                Ok(_) => return failure("A file query is required".into()),
                Err(error) => return failure(format!("Invalid find arguments: {error}")),
            };
            let result = crate::routes::file_search::search_file_names_in_workspaces(
                context.workspaces(),
                crate::models::FileNameSearchQuery {
                    search: arguments.query,
                    workspace_id: None,
                    max_results: Some(40),
                    use_ignore_files: true,
                },
                crate::models::SearchCancellation::from_flag(cancellation.flag()),
            )
            .await;
            match result {
                Ok(response) => ToolResult {
                    content: json!({ "paths": response.results.into_iter().map(|entry| entry.path).collect::<Vec<_>>() }).to_string(),
                    is_error: false,
                    failure_code: None,
                    retry_failures: Vec::new(),
                },
                Err(error) => failure(format!("File search failed: {error:?}")),
            }
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
