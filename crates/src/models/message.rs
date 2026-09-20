use serde::{Deserialize, Serialize};

/// The normalized roles retained by an in-memory AI session transcript.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatRole {
    User,
    Assistant,
}

/// A normalized text message held by an AI session actor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
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
}
