use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

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

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct PrepareAgentAttachment {
    pub filename: String,
    pub media_type: String,
    pub byte_size: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct PreparedAgentAttachment {
    pub session_id: String,
    pub attachment: super::AiSessionAttachment,
    pub upload_url: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct CompleteAgentAttachment {
    pub etag: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct CompletedAgentAttachment {
    pub attachment_id: String,
    pub etag: Option<String>,
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
    /// Tool calls durably planned before a process stopped. The executor runs
    /// these before asking the model for another decision.
    pub resume_tool_calls: Vec<OpenAiToolCall>,
}

#[derive(Clone, Debug)]
pub struct AgentToolResult {
    pub content: String,
    pub is_error: bool,
    pub failure_code: Option<crate::agent::error::AgentFailureCode>,
    pub retry_failures: Vec<crate::agent::tools::ToolRetryFailure>,
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
#[derive(Debug)]
pub enum AgentActorEvent {
    Started {
        task: AgentTask,
    },
    ModelStarted {
        task: AgentTask,
        attempt: u32,
        /// The worker must wait for this permit before sending a provider
        /// request. `true` means the session actor committed the intent and
        /// state transition to JSONL and synced it successfully.
        permit: oneshot::Sender<bool>,
    },
    ThinkingDelta {
        task: AgentTask,
        attempt: u32,
        text: String,
    },
    TextDelta {
        task: AgentTask,
        attempt: u32,
        text: String,
    },
    ModelSettled {
        task: AgentTask,
        attempt: u32,
        response: AssistantResponse,
    },
    ToolCallsProposed {
        task: AgentTask,
        calls: Vec<OpenAiToolCall>,
    },
    ToolConfirmationRequested {
        task: AgentTask,
        call: OpenAiToolCall,
        confirmation_id: String,
    },
    ToolStarted {
        task: AgentTask,
        call: OpenAiToolCall,
        /// The worker must wait for this permit before invoking the tool.
        permit: oneshot::Sender<bool>,
    },
    ToolFinished {
        task: AgentTask,
        call_id: String,
        result: AgentToolResult,
    },
    Completed {
        task: AgentTask,
        usage: Option<AiTokenUsage>,
    },
    Failed {
        task: AgentTask,
        code: crate::agent::error::AgentFailureCode,
        detail: String,
    },
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
