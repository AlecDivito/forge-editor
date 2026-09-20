use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::error::AgentFailureCode;

/// The on-disk JSONL schema version for durable AI session records.
pub const AI_SESSION_RECORD_VERSION: u8 = 1;

/// The normalized roles retained by an in-memory AI session transcript.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

/// A normalized text message held by an AI session actor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}

#[derive(Serialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<OpenAiChatMessage>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<OpenAiToolDefinition>>,
    /// Provider-specific OpenAI-compatible request options. vLLM uses this
    /// for chat-template controls such as Qwen's thinking mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_template_kwargs: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
pub struct OpenAiChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OpenAiToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct OpenAiToolDefinition {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub function: OpenAiToolFunction,
}

#[derive(Clone, Debug, Serialize)]
pub struct OpenAiToolFunction {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OpenAiToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub function: OpenAiToolCallFunction,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OpenAiToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Deserialize)]
pub struct ChatCompletionChunk {
    pub choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize)]
pub struct ChatCompletionChoice {
    pub delta: ChatCompletionDelta,
}

#[derive(Deserialize)]
pub struct ChatCompletionDelta {
    pub content: Option<String>,
    #[serde(default)]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<OpenAiToolCallDelta>,
}

#[derive(Deserialize)]
pub struct OpenAiToolCallDelta {
    pub index: usize,
    pub id: Option<String>,
    pub function: Option<OpenAiToolCallFunctionDelta>,
}

#[derive(Deserialize)]
pub struct OpenAiToolCallFunctionDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

/// A completed assistant turn, including provider reasoning kept separately
/// from the visible response content.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssistantResponse {
    pub content: String,
    pub thinking: Option<String>,
    pub tool_calls: Vec<OpenAiToolCall>,
}

impl AssistantResponse {
    pub fn new(content: String, thinking: String) -> Self {
        let content = content.trim().to_owned();
        let thinking = (!thinking.trim().is_empty()).then(|| thinking.trim().to_owned());
        Self {
            content,
            thinking,
            tool_calls: Vec::new(),
        }
    }
}

/// A model selection retained with a durable session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiSessionModel {
    pub provider: String,
    pub model_id: String,
}

/// The human-facing, durable identity of an AI session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiSessionMetadata {
    pub id: String,
    pub title: String,
    pub created_at_ms: u64,
    pub model: Option<AiSessionModel>,
}

/// One immutable JSONL record in an AI session file.
///
/// Records intentionally describe settled state only; streamed deltas remain
/// ephemeral until their assistant message completes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AiSessionRecord {
    SessionCreated {
        version: u8,
        metadata: AiSessionMetadata,
    },
    SessionNamed {
        version: u8,
        title: String,
        updated_at_ms: u64,
    },
    ModelSelected {
        version: u8,
        model: AiSessionModel,
        updated_at_ms: u64,
    },
    Message {
        version: u8,
        role: ChatRole,
        content: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thinking: Option<String>,
        created_at_ms: u64,
    },
    ToolCall {
        version: u8,
        tool_call_id: String,
        name: String,
        arguments: Value,
        created_at_ms: u64,
    },
    ToolResult {
        version: u8,
        tool_call_id: String,
        content: String,
        is_error: bool,
        created_at_ms: u64,
    },
    Failure {
        version: u8,
        /// A stable machine-readable category. Older session files omit it.
        #[serde(default)]
        code: AgentFailureCode,
        /// A generic, safe message that may be shown to a client.
        message: String,
        /// Diagnostic context retained only in the durable session log.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        created_at_ms: u64,
    },
}

/// An in-memory reconstruction of one durable AI session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AiSession {
    pub metadata: AiSessionMetadata,
    pub messages: Vec<ChatMessage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<AiSessionToolCall>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_results: Vec<AiSessionToolResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<AiSessionFailure>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiSessionToolCall {
    pub tool_call_id: String,
    pub name: String,
    pub arguments: Value,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiSessionToolResult {
    pub tool_call_id: String,
    pub content: String,
    pub is_error: bool,
    pub created_at_ms: u64,
}

/// A failed model turn retained separately from the transcript.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiSessionFailure {
    #[serde(default)]
    pub code: AgentFailureCode,
    pub message: String,
    #[serde(skip_serializing)]
    pub detail: Option<String>,
    pub created_at_ms: u64,
}

/// The compact representation returned when listing sessions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AiSessionSummary {
    pub metadata: AiSessionMetadata,
    pub message_count: usize,
}
