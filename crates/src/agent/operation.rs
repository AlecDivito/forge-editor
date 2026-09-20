//! Durable state for one accepted agent request.
//!
//! This is intentionally provider- and tool-agnostic. The actor will append
//! immutable transitions and reconstruct this snapshot on restart.

use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct OperationSnapshot {
    pub operation_id: String,
    pub request_id: String,
    pub state: OperationState,
    pub accepted_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OperationState {
    Accepted,
    Preparing,
    ModelInFlight { attempt: u32 },
    ToolsPlanned { tool_call_ids: Vec<String> },
    ToolInFlight { tool_call_id: String },
    Completed,
    Failed,
    Cancelled { reason: String },
    Interrupted { reason: String },
}

impl OperationState {
    pub const fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled { .. } | Self::Interrupted { .. }
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct OperationTransition {
    pub operation_id: String,
    pub request_id: String,
    pub state: OperationState,
    pub occurred_at_ms: u64,
}

impl OperationSnapshot {
    pub fn apply(&mut self, transition: OperationTransition) -> Result<(), &'static str> {
        if self.operation_id != transition.operation_id || self.request_id != transition.request_id
        {
            return Err("operation transition belongs to another operation");
        }
        if self.state.is_terminal() {
            return Err("cannot transition a terminal operation");
        }
        self.state = transition.state;
        self.updated_at_ms = transition.occurred_at_ms;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{OperationSnapshot, OperationState, OperationTransition};

    #[test]
    fn terminal_operations_reject_later_transitions() {
        let mut operation = OperationSnapshot {
            operation_id: "op-1".into(),
            request_id: "request-1".into(),
            state: OperationState::Accepted,
            accepted_at_ms: 1,
            updated_at_ms: 1,
        };
        operation
            .apply(OperationTransition {
                operation_id: "op-1".into(),
                request_id: "request-1".into(),
                state: OperationState::Completed,
                occurred_at_ms: 2,
            })
            .unwrap();
        assert!(
            operation
                .apply(OperationTransition {
                    operation_id: "op-1".into(),
                    request_id: "request-1".into(),
                    state: OperationState::Preparing,
                    occurred_at_ms: 3
                })
                .is_err()
        );
    }
}
