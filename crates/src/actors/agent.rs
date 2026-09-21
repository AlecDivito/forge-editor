//! Ephemeral executor for a single claimed agent operation.
//!
//! This actor has no session repository and cannot publish durable state. It
//! reports every observation to `AiSessionActor`, which decides whether to
//! append, publish, continue, cancel, or replace the worker after recovery.

use std::sync::Arc;

use tokio::{sync::{mpsc, oneshot}, task::JoinHandle};

use serde_json::Value;

use crate::{
    agent::error::AgentFailureCode,
    agent::tools::{ToolContext, ToolRegistry},
    actors::ai_session::stream_openai_compatible,
    config::OpenAiCompatibleConfig,
    models::{AgentActorEvent, AgentStreamDelta, AgentTask},
};

enum AgentActorCommand {
    RunTurn { task: AgentTask },
    Stop { result: oneshot::Sender<()> },
}

/// A deliberately short-lived executor for one complete agent turn. It owns
/// model -> tool batch -> model progression; it never opens a session file.
pub struct AgentActor {
    commands: mpsc::Sender<AgentActorCommand>,
}

impl AgentActor {
    pub fn spawn(
        config: OpenAiCompatibleConfig,
        tools: ToolRegistry,
        tool_context: ToolContext,
        events: mpsc::Sender<AgentActorEvent>,
    ) -> Arc<Self> {
        let (commands, mut receiver) = mpsc::channel(2);
        tokio::spawn(async move {
            let mut active: Option<(AgentTask, oneshot::Sender<()>, JoinHandle<()>)> = None;
            while let Some(command) = receiver.recv().await {
                match command {
                    AgentActorCommand::RunTurn { task } => {
                        if active.is_some() {
                            let _ = events.send(AgentActorEvent::Failed { task, code: AgentFailureCode::AgentExecutionFailed, detail: "An agent worker can only execute one turn".into() }).await;
                            continue;
                        }
                        let task_for_runner = task.clone();
                        let runner_events = events.clone();
                        let runner_config = config.clone();
                        let runner_tools = tools.clone();
                        let runner_context = tool_context.clone();
                        let (cancel, cancellation) = oneshot::channel();
                        let handle = tokio::spawn(async move {
                            run_turn(task_for_runner, runner_config, runner_tools, runner_context, runner_events, cancellation).await;
                        });
                        active = Some((task, cancel, handle));
                    }
                    AgentActorCommand::Stop { result } => {
                        if let Some((_task, cancellation, _handle)) = active.take() {
                            // Do not abort: the runner emits Cancelled with its
                            // accumulated model deltas, which the session actor
                            // durably writes before marking the operation done.
                            let _ = cancellation.send(());
                        }
                        let _ = result.send(());
                        break;
                    }
                }
            }
        });
        Arc::new(Self { commands })
    }

    pub async fn run_turn(&self, task: AgentTask) -> Result<(), ()> {
        self.commands.send(AgentActorCommand::RunTurn { task }).await.map_err(|_| ())
    }

    pub async fn stop(&self) {
        let (result, receiver) = oneshot::channel();
        if self.commands.send(AgentActorCommand::Stop { result }).await.is_ok() {
            let _ = receiver.await;
        }
    }
}

async fn run_turn(
    task: AgentTask,
    config: OpenAiCompatibleConfig,
    tools: ToolRegistry,
    tool_context: ToolContext,
    events: mpsc::Sender<AgentActorEvent>,
    mut cancellation: oneshot::Receiver<()>,
) {
    const MAX_MODEL_ROUNDS: u32 = 8;
    let _ = events.send(AgentActorEvent::Started { task: task.clone() }).await;
    let mut context = task.context.clone();
    let mut total_usage: Option<crate::models::AiTokenUsage> = None;

    for attempt in 1..=MAX_MODEL_ROUNDS {
        if cancellation.try_recv().is_ok() {
            let _ = events.send(AgentActorEvent::Cancelled { task: task.clone(), partial_text: String::new(), partial_thinking: String::new(), attempt: None, cancelled_tool_call_id: None }).await;
            return;
        }
        let _ = events.send(AgentActorEvent::ModelStarted { task: task.clone(), attempt }).await;
        let mut partial_text = String::new();
        let mut partial_thinking = String::new();
        let response = {
            let (transport, mut transport_events) = mpsc::channel(32);
            let request = stream_openai_compatible(
                &config, &task.model_id, &context, &tools, transport,
            );
            tokio::pin!(request);
            loop {
                tokio::select! {
                    _ = &mut cancellation => {
                        let _ = events.send(AgentActorEvent::Cancelled {
                            task: task.clone(),
                            partial_text,
                            partial_thinking,
                            attempt: Some(attempt),
                            cancelled_tool_call_id: None,
                        }).await;
                        return;
                    }
                    result = &mut request => break result,
                    message = transport_events.recv() => {
                        match message {
                            Some(AgentStreamDelta::Text(text)) => {
                                partial_text.push_str(&text);
                                let _ = events.send(AgentActorEvent::TextDelta { task: task.clone(), attempt, text }).await;
                            }
                            Some(AgentStreamDelta::Thinking(text)) => {
                                partial_thinking.push_str(&text);
                                let _ = events.send(AgentActorEvent::ThinkingDelta { task: task.clone(), attempt, text }).await;
                            }
                            _ => {}
                        }
                    }
                }
            }
        };
        let response = match response {
            Ok(response) => response,
            Err(detail) => {
                let _ = events.send(AgentActorEvent::Failed { task, code: AgentFailureCode::ModelStreamFailed, detail }).await;
                return;
            }
        };
        if let Some(usage) = &response.usage {
            total_usage = Some(match total_usage { Some(mut total) => { total.add_assign(usage); total }, None => usage.clone() });
        }
        let _ = events.send(AgentActorEvent::ModelSettled { task: task.clone(), attempt, response: response.clone() }).await;
        if response.tool_calls.is_empty() {
            let _ = events.send(AgentActorEvent::Completed { task, usage: total_usage }).await;
            return;
        }
        let _ = events.send(AgentActorEvent::ToolCallsProposed { task: task.clone(), calls: response.tool_calls.clone() }).await;
        context.push(crate::models::OpenAiChatMessage { role: "assistant".into(), content: (!response.content.is_empty()).then_some(response.content), tool_calls: Some(response.tool_calls.clone()), tool_call_id: None });
        for call in response.tool_calls {
            let arguments = serde_json::from_str(&call.function.arguments).unwrap_or_else(|_| Value::String(call.function.arguments.clone()));
            let _ = events.send(AgentActorEvent::ToolStarted { task: task.clone(), call: call.clone() }).await;
            let result = tokio::select! {
                _ = &mut cancellation => {
                    let _ = events.send(AgentActorEvent::Cancelled { task: task.clone(), partial_text: String::new(), partial_thinking: String::new(), attempt: Some(attempt), cancelled_tool_call_id: Some(call.id.clone()) }).await;
                    return;
                }
                result = tools.execute(tool_context.clone(), &call.function.name, arguments) => result,
            };
            let tool_result = crate::models::AgentToolResult { content: result.content, is_error: result.is_error };
            context.push(crate::models::OpenAiChatMessage { role: "tool".into(), content: Some(tool_result.content.clone()), tool_calls: None, tool_call_id: Some(call.id.clone()) });
            let _ = events.send(AgentActorEvent::ToolFinished { task: task.clone(), call_id: call.id, result: tool_result }).await;
        }
    }
    let _ = events.send(AgentActorEvent::Failed {
        task,
        code: AgentFailureCode::ToolRoundLimitExceeded,
        detail: "The agent exceeded its maximum tool-call rounds".into(),
    }).await;
}
