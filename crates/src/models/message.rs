use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::error::AgentFailureCode;
use crate::agent::operation::{OperationSnapshot, OperationTransition};

/// The only on-disk JSONL schema version. Forge is not deployed yet, so we do
/// not carry a compatibility layer for a superseded session format.
pub const AI_SESSION_RECORD_VERSION: u8 = 2;

/// The normalized roles retained by an in-memory AI session transcript.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

/// The source and scope of a durable tool approval decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolApprovalDecision {
    AllowOnce,
    AllowAlways,
    Deny,
}

/// The exact, user-facing action awaiting approval. New side-effecting tools
/// must add a typed variant here instead of leaking arbitrary JSON arguments
/// into the approval contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolConfirmationRequest {
    Bash { command: String },
}

/// Durable metadata for a session-owned object-store image. Image bytes are
/// never included in JSONL; the object key is only consumed by Forge's
/// attachment store when it constructs a provider request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiSessionAttachment {
    pub attachment_id: String,
    pub object_key: String,
    pub filename: String,
    pub media_type: String,
    pub byte_size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// A normalized text message held by an AI session actor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
    /// Timestamp of the settled JSONL message record. This lets restored
    /// clients interleave messages with durable tool events correctly.
    #[serde(default)]
    pub created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<AiTokenUsage>,
}

/// Token accounting reported by an OpenAI-compatible model backend.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiTokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<u64>,
}

impl AiTokenUsage {
    pub fn add_assign(&mut self, other: &Self) {
        self.prompt_tokens += other.prompt_tokens;
        self.completion_tokens += other.completion_tokens;
        self.total_tokens += other.total_tokens;
        self.cached_tokens = self
            .cached_tokens
            .zip(other.cached_tokens)
            .map(|(left, right)| left + right)
            .or(self.cached_tokens)
            .or(other.cached_tokens);
        self.reasoning_tokens = self
            .reasoning_tokens
            .zip(other.reasoning_tokens)
            .map(|(left, right)| left + right)
            .or(self.reasoning_tokens)
            .or(other.reasoning_tokens);
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<OpenAiStreamOptions>,
}

#[derive(Serialize)]
pub struct OpenAiStreamOptions {
    pub include_usage: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct OpenAiChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
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
    #[serde(default)]
    pub usage: Option<OpenAiUsage>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct OpenAiUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    #[serde(default)]
    pub prompt_tokens_details: Option<OpenAiPromptTokensDetails>,
    #[serde(default)]
    pub completion_tokens_details: Option<OpenAiCompletionTokensDetails>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct OpenAiPromptTokensDetails {
    #[serde(default)]
    pub cached_tokens: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct OpenAiCompletionTokensDetails {
    #[serde(default)]
    pub reasoning_tokens: Option<u64>,
}

impl From<OpenAiUsage> for AiTokenUsage {
    fn from(usage: OpenAiUsage) -> Self {
        Self {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            cached_tokens: usage
                .prompt_tokens_details
                .and_then(|details| details.cached_tokens),
            reasoning_tokens: usage
                .completion_tokens_details
                .and_then(|details| details.reasoning_tokens),
        }
    }
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
    pub usage: Option<AiTokenUsage>,
}

impl AssistantResponse {
    pub fn new(content: String, thinking: String) -> Self {
        let content = content.trim().to_owned();
        let thinking = (!thinking.trim().is_empty()).then(|| thinking.trim().to_owned());
        Self {
            content,
            thinking,
            tool_calls: Vec::new(),
            usage: None,
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

/// A durable, ordered item in a session. This is deliberately the shared
/// protocol boundary for storage, HTTP restoration, and future WebSocket
/// replay. `sequence` is the source of ordering; timestamps are display data.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiSessionEvent {
    pub event_id: String,
    pub sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_sequence: Option<u64>,
    pub occurred_at_ms: u64,
    pub kind: AiSessionEventKind,
}

/// Presentation and agent replay both fold this one enum. New variants must be
/// additive so old clients can retain unknown events as durable history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AiSessionEventKind {
    SessionCreated {
        metadata: AiSessionMetadata,
    },
    SessionNamed {
        title: String,
    },
    ModelSelected {
        model: AiSessionModel,
    },
    OperationTransition {
        transition: OperationTransition,
    },
    Message {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
        role: ChatRole,
        content: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thinking: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<AiTokenUsage>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        attachment_ids: Vec<String>,
    },
    Reasoning {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning_id: Option<String>,
        content: String,
    },
    UserMessageQueued {
        message_id: String,
        content: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        attachment_ids: Vec<String>,
    },
    /// Tombstone for a queued prompt that was edited or explicitly cancelled
    /// before the scheduler made it model-visible.
    UserMessageCancelled {
        message_id: String,
        reason: String,
    },
    AttachmentPrepared {
        attachment: AiSessionAttachment,
    },
    AttachmentUploaded {
        attachment_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        etag: Option<String>,
    },
    AttachmentAbandoned {
        attachment_id: String,
        reason: String,
    },
    /// A provider request is durably identified before it is sent. The
    /// request hash identifies its committed context without persisting a
    /// second mutable transcript.
    ModelIntent {
        turn_id: String,
        attempt: u32,
        model_id: String,
        request_hash: String,
        assistant_message_id: String,
        reasoning_message_id: String,
    },
    ToolCall {
        tool_call_id: String,
        name: String,
        arguments: Value,
    },
    /// A side-effecting tool is paused until a human resolves this exact
    /// normalized call. This is durable so a prompt is never mistaken for an
    /// already-authorized command after reconnect or restart.
    ToolConfirmationRequested {
        confirmation_id: String,
        tool_call_id: String,
        request: ToolConfirmationRequest,
    },
    ToolConfirmationResolved {
        confirmation_id: String,
        decision: ToolApprovalDecision,
    },
    /// A later user prompt superseded an outstanding approval. This is not a
    /// denial: no person made a decision about the command.
    ToolConfirmationCancelled {
        confirmation_id: String,
        reason: String,
    },
    /// Exact normalized arguments and replay policy are committed before a
    /// tool begins an external effect.
    ToolIntent {
        tool_call_id: String,
        name: String,
        arguments: Value,
        attempt: u32,
        replay_class: crate::agent::operation::ToolReplayClass,
    },
    ToolResult {
        tool_call_id: String,
        content: String,
        is_error: bool,
    },
    Failure {
        #[serde(default)]
        code: AgentFailureCode,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}

/// One immutable JSONL record. A session is an event stream—there is no second
/// legacy record format to merge or migrate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AiSessionRecord {
    Event { version: u8, event: AiSessionEvent },
}

/// The in-memory projection of one session-scoped event log. It contains no
/// separately persisted transcript or tool collections: those are derived from
/// `events` by the consumer that needs them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AgentSessionLog {
    pub metadata: AiSessionMetadata,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operations: Vec<OperationSnapshot>,
    /// The canonical ordered presentation stream.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<AiSessionEvent>,
}

impl AgentSessionLog {
    pub fn settled_messages(&self) -> Vec<ChatMessage> {
        self.events
            .iter()
            .filter_map(|event| match &event.kind {
                AiSessionEventKind::Message {
                    role,
                    content,
                    thinking,
                    usage,
                    ..
                } => Some(ChatMessage {
                    role: role.clone(),
                    content: content.clone(),
                    thinking: thinking.clone(),
                    usage: usage.clone(),
                    created_at_ms: event.occurred_at_ms,
                }),
                _ => None,
            })
            .collect()
    }

    pub fn message_count(&self) -> usize {
        self.events
            .iter()
            .filter(|event| matches!(event.kind, AiSessionEventKind::Message { .. }))
            .count()
    }
}

/// The compact representation returned when listing sessions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AiSessionSummary {
    pub metadata: AiSessionMetadata,
    pub message_count: usize,
}
