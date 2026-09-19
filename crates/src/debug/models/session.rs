use crate::debug::PublicCapabilities;
use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Public lifecycle of a Forge-owned debug session.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Creating,
    SpawningAdapter,
    Initializing,
    Launching,
    Configuring,
    Running,
    Terminating,
    Terminated,
    Failed,
}

/// Bounded, sanitized output retained in a session snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk {
    pub sequence: u64,
    pub category: String,
    pub output: String,
}

/// Durable public view of a debug session.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub session_id: String,
    pub workspace_id: String,
    pub configuration_id: String,
    pub configuration_name: String,
    pub state: SessionState,
    pub event_cursor: u64,
    pub output: Vec<OutputChunk>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub capabilities: PublicCapabilities,
}

/// Request body for starting a session from a discovered configuration.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateSession {
    pub configuration_id: String,
    pub configuration_revision: String,
    pub active_file_id: Option<String>,
}
