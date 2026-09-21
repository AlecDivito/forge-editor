use rovo::schemars::JsonSchema;
use serde::Serialize;

use super::{AiTokenUsage, AssistantResponse, OpenAiChatMessage, OpenAiToolCall};

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct AgentModelDescriptor {
    pub id: String,
    pub label: String,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct AgentModelCatalog {
    pub configured: bool,
    pub models: Vec<AgentModelDescriptor>,
}

/// Immutable work handed from the durable session coordinator to one
/// short-lived agent executor. It is intentionally not a persisted record.
#[derive(Clone, Debug)]
pub struct AgentTask {
    pub session_id: String,
    pub operation_id: String,
    pub request_id: String,
    pub model_id: String,
    pub context: Vec<OpenAiChatMessage>,
}

#[derive(Clone, Debug)]
pub struct AgentToolResult {
    pub content: String,
    pub is_error: bool,
}

/// A partial model response. This is internal to the agent worker: it is not
/// durable session state and it is never sent to a client directly.
#[derive(Clone, Debug)]
pub enum AgentStreamDelta {
    Text(String),
    Thinking(String),
}

/// Ephemeral observations emitted by an executor. `AiSessionActor` translates
/// these into durable session events after writer acknowledgement.
#[derive(Clone, Debug)]
pub enum AgentActorEvent {
    Started { task: AgentTask },
    ModelStarted { task: AgentTask, attempt: u32 },
    ThinkingDelta { task: AgentTask, attempt: u32, text: String },
    TextDelta { task: AgentTask, attempt: u32, text: String },
    ModelSettled { task: AgentTask, attempt: u32, response: AssistantResponse },
    ToolCallsProposed { task: AgentTask, calls: Vec<OpenAiToolCall> },
    ToolStarted { task: AgentTask, call: OpenAiToolCall },
    ToolFinished { task: AgentTask, call_id: String, result: AgentToolResult },
    Completed { task: AgentTask, usage: Option<AiTokenUsage> },
    Failed { task: AgentTask, code: crate::agent::error::AgentFailureCode, detail: String },
    /// Cancellation is cooperative so deltas already observed from the model
    /// can be committed by the session owner before the operation closes.
    Cancelled {
        task: AgentTask,
        partial_text: String,
        partial_thinking: String,
        attempt: Option<u32>,
        cancelled_tool_call_id: Option<String>,
    },
}
