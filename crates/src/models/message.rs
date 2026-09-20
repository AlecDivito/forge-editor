use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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
}

#[derive(Serialize)]
pub struct OpenAiChatMessage {
    pub role: &'static str,
    pub content: String,
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
}

/// A completed assistant turn, including provider reasoning kept separately
/// from the visible response content.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssistantResponse {
    pub content: String,
    pub thinking: Option<String>,
}

impl AssistantResponse {
    pub fn new(content: String, thinking: String) -> Self {
        let content = content.trim().to_owned();
        let thinking = (!thinking.trim().is_empty()).then(|| thinking.trim().to_owned());
        Self { content, thinking }
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
    Failure {
        version: u8,
        message: String,
        created_at_ms: u64,
    },
}

/// An in-memory reconstruction of one durable AI session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AiSession {
    pub metadata: AiSessionMetadata,
    pub messages: Vec<ChatMessage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<AiSessionFailure>,
}

/// A failed model turn retained separately from the transcript.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AiSessionFailure {
    pub message: String,
    pub created_at_ms: u64,
}

/// The compact representation returned when listing sessions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AiSessionSummary {
    pub metadata: AiSessionMetadata,
    pub message_count: usize,
}
