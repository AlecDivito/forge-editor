use std::{future::Future, pin::Pin, time::Duration};

use serde::Deserialize;
use serde_json::json;

use super::{AgentTool, ToolCancellation, ToolContext, ToolDescriptor, ToolResult};

pub struct GrepTool;

#[derive(Deserialize)]
struct GrepArguments {
    query: String,
}

impl AgentTool for GrepTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            name: "grep",
            description: "Search text content across files in the configured Forge project.",
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["query"],
                "properties": { "query": { "type": "string" } }
            }),
            timeout: Duration::from_secs(20),
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
            let arguments = match serde_json::from_value::<GrepArguments>(arguments) {
                Ok(arguments) if !arguments.query.trim().is_empty() => arguments,
                Ok(_) => return failure("A text query is required".into()),
                Err(error) => return failure(format!("Invalid grep arguments: {error}")),
            };
            let workspaces = context.workspaces();
            let result = crate::routes::file_search::search_files_in_workspaces(
                workspaces.clone(),
                vec![None; workspaces.len()],
                crate::models::FsSearchQuery {
                    search: arguments.query,
                    replace: String::new(),
                    match_case: false,
                    match_whole_word: false,
                    regex: false,
                    preserve_case: false,
                    include: None,
                    exclude: None,
                    open_files_only: false,
                    use_ignore_files: true,
                    max_results: Some(40),
                },
                crate::models::SearchCancellation::from_flag(cancellation.flag()),
            )
            .await;
            match result {
                Ok(response) => ToolResult {
                    content: json!({ "matches": response.results.into_iter().map(|entry| json!({ "path": entry.file.path, "matches": entry.matches })).collect::<Vec<_>>() }).to_string(),
                    is_error: false,
                    failure_code: None,
                    retry_failures: Vec::new(),
                },
                Err(error) => failure(format!("Content search failed: {error:?}")),
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
