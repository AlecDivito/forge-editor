//! Pure projections of the durable agent event stream.
//!
//! The actor never owns a second transcript. It asks this reducer what work is
//! unfinished and which ordered records are safe to send to the provider.

use std::collections::{HashMap, HashSet};

use crate::{
    agent::operation::OperationStatus,
    models::{AgentSessionLog, AiSessionEventKind, OpenAiChatMessage, OpenAiToolCall, OpenAiToolCallFunction},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingToolCall {
    pub operation_id: String,
    pub tool_call_id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// The execution projection. It deliberately has no mutation methods: append
/// an event, then create a fresh projection from the log.
#[derive(Clone, Debug)]
pub struct AgentProjection {
    pub runnable_operation_ids: Vec<String>,
    pub pending_tool_calls: Vec<PendingToolCall>,
}

impl AgentProjection {
    pub fn from_log(log: &AgentSessionLog) -> Self {
        let settled_calls = log
            .events
            .iter()
            .filter_map(|event| match &event.kind {
                AiSessionEventKind::ToolResult { tool_call_id, .. } => Some(tool_call_id.as_str()),
                _ => None,
            })
            .collect::<HashSet<_>>();
        let pending_tool_calls = log
            .events
            .iter()
            .filter_map(|event| match (&event.operation_id, &event.kind) {
                (Some(operation_id), AiSessionEventKind::ToolCall { tool_call_id, name, arguments })
                    if !settled_calls.contains(tool_call_id.as_str()) => Some(PendingToolCall {
                        operation_id: operation_id.clone(),
                        tool_call_id: tool_call_id.clone(),
                        name: name.clone(),
                        arguments: arguments.clone(),
                    }),
                _ => None,
            })
            .collect::<Vec<_>>();
        let runnable_operation_ids = log
            .operations
            .iter()
            .filter(|operation| operation.status != OperationStatus::Complete)
            .map(|operation| operation.operation_id.clone())
            .collect();
        Self { runnable_operation_ids, pending_tool_calls }
    }

    /// Reconstructs provider messages from events only. An unfinished tool
    /// round is represented as the model's tool-call message followed by every
    /// settled tool result, exactly as OpenAI expects for the next round.
    pub fn model_context(&self, log: &AgentSessionLog, operation_id: &str) -> Vec<OpenAiChatMessage> {
        let mut messages = Vec::new();
        let mut calls = HashMap::<String, Vec<OpenAiToolCall>>::new();
        for event in &log.events {
            match &event.kind {
                AiSessionEventKind::Message { role, content, .. } => {
                    // Future accepted operations remain visible in history but
                    // do not become input to the currently claimed operation.
                    if event.operation_id.as_deref().is_some_and(|id| id != operation_id)
                        && log.operations.iter().any(|operation| operation.operation_id == event.operation_id.clone().unwrap_or_default() && operation.status != OperationStatus::Complete)
                    {
                        continue;
                    }
                    messages.push(OpenAiChatMessage {
                        role: match role { crate::models::ChatRole::User => "user", crate::models::ChatRole::Assistant => "assistant" }.into(),
                        content: Some(content.clone()), tool_calls: None, tool_call_id: None,
                    });
                }
                AiSessionEventKind::ToolCall { tool_call_id, name, arguments } => {
                    calls.entry(event.operation_id.clone().unwrap_or_default()).or_default().push(OpenAiToolCall {
                        id: tool_call_id.clone(), kind: "function", function: OpenAiToolCallFunction { name: name.clone(), arguments: arguments.to_string() },
                    });
                }
                AiSessionEventKind::ToolResult { tool_call_id, content, .. } => {
                    if let Some(owner) = event.operation_id.as_ref() {
                        if let Some(tool_calls) = calls.remove(owner) {
                            messages.push(OpenAiChatMessage { role: "assistant".into(), content: None, tool_calls: Some(tool_calls), tool_call_id: None });
                        }
                    }
                    messages.push(OpenAiChatMessage { role: "tool".into(), content: Some(content.clone()), tool_calls: None, tool_call_id: Some(tool_call_id.clone()) });
                }
                _ => {}
            }
        }
        messages
    }
}

#[cfg(test)]
mod tests {
    use super::AgentProjection;
    use crate::{
        agent::operation::{OperationSnapshot, OperationState, OperationStatus},
        models::{AgentSessionLog, AiSessionEvent, AiSessionEventKind, AiSessionMetadata, ChatRole},
    };

    fn message(sequence: u64, operation_id: &str, content: &str) -> AiSessionEvent {
        AiSessionEvent {
            event_id: format!("event-{sequence}"),
            sequence,
            operation_id: Some(operation_id.into()),
            operation_sequence: Some(sequence),
            occurred_at_ms: sequence,
            kind: AiSessionEventKind::Message {
                message_id: None,
                role: ChatRole::User,
                content: content.into(),
                thinking: None,
                usage: None,
            },
        }
    }

    #[test]
    fn model_context_excludes_future_unfinished_operations() {
        let log = AgentSessionLog {
            metadata: AiSessionMetadata { id: "session".into(), title: "Test".into(), created_at_ms: 1, model: None },
            operations: vec![
                OperationSnapshot { operation_id: "first".into(), request_id: "first".into(), operation_sequence: 1, status: OperationStatus::Complete, state: OperationState::Completed, accepted_at_ms: 1, updated_at_ms: 2 },
                OperationSnapshot { operation_id: "second".into(), request_id: "second".into(), operation_sequence: 2, status: OperationStatus::Waiting, state: OperationState::Preparing, accepted_at_ms: 3, updated_at_ms: 3 },
                OperationSnapshot { operation_id: "future".into(), request_id: "future".into(), operation_sequence: 3, status: OperationStatus::Pending, state: OperationState::Queued, accepted_at_ms: 4, updated_at_ms: 4 },
            ],
            events: vec![message(1, "first", "finished request"), message(2, "second", "current request"), message(3, "future", "queued request")],
        };
        let messages = AgentProjection::from_log(&log).model_context(&log, "second");
        assert_eq!(messages.iter().map(|message| message.content.as_deref()).collect::<Vec<_>>(), vec![Some("finished request"), Some("current request")]);
    }
}
