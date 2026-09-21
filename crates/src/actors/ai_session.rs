use std::{collections::HashMap, sync::Arc, time::Duration};

use futures_util::StreamExt;
use tokio::sync::{mpsc, oneshot};

use crate::{
    agent::error::AgentFailureCode,
    agent::operation::{OperationState, OperationStatus, OperationTransition},
    agent::session::reducer::AgentProjection,
    agent::tools::{ToolContext, ToolRegistry},
    actors::AgentActor,
    config::OpenAiCompatibleConfig,
    models::{
        AgentActorEvent, AgentSessionLog, AgentStreamDelta, AgentTask, AiSessionEvent, AiSessionEventKind, AiSessionMetadata, AiSessionModel,
        AssistantResponse, ChatCompletionChunk, ChatCompletionRequest,
        ChatRole, OpenAiChatMessage, OpenAiToolCall, OpenAiToolCallFunction, ServerMessage,
    },
    services::ai_session::AiSessionService,
    util::time::now_ms,
};

pub struct AiSessionActor {
    commands: mpsc::Sender<AiSessionCommand>,
}

impl std::fmt::Debug for AiSessionActor {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AiSessionActor")
            .finish_non_exhaustive()
    }
}

enum AiSessionCommand {
    Start {
        recipient: Option<mpsc::Sender<ServerMessage>>,
        result: oneshot::Sender<Result<AiSessionMetadata, String>>,
    },
    Prompt {
        request_id: String,
        provider: String,
        model_id: String,
        prompt: String,
        recipient: mpsc::Sender<ServerMessage>,
    },
    TitleGenerated {
        request_id: String,
        result: Result<Option<String>, String>,
        recipient: mpsc::Sender<ServerMessage>,
    },
    Stop {
        request_id: String,
        recipient: mpsc::Sender<ServerMessage>,
    },
    AgentEvent {
        event: AgentActorEvent,
        recipient: mpsc::Sender<ServerMessage>,
    },
}

struct PendingPrompt {
    model_id: String,
    recipient: mpsc::Sender<ServerMessage>,
}

impl AiSessionActor {
    pub fn spawn(
        session_id: String,
        config: Option<OpenAiCompatibleConfig>,
        sessions: Arc<AiSessionService>,
        tool_context: ToolContext,
    ) -> Arc<Self> {
        let (commands, mut receiver) = mpsc::channel(8);
        let actor_commands = commands.clone();
        tokio::spawn(async move {
            let mut session = None;
            let mut runners = HashMap::<String, Arc<AgentActor>>::new();
            let mut pending = HashMap::<String, PendingPrompt>::new();
            // The execution lifetime is independent from this handle. It is
            // only the latest place to publish committed events and deltas.
            let mut live_recipient: Option<mpsc::Sender<ServerMessage>> = None;
            while let Some(command) = receiver.recv().await {
                match command {
                    AiSessionCommand::Start { recipient, result } => {
                        if let Some(recipient) = &recipient {
                            live_recipient = Some(recipient.clone());
                        }
                        // Durable recovery is allowed to run without a
                        // connected client. All sends to this detached sender
                        // are best-effort; writes still receive their receipt.
                        let recovery_recipient = recipient.clone().unwrap_or_else(|| {
                            let (sender, receiver) = mpsc::channel(1);
                            drop(receiver);
                            sender
                        });
                        let outcome = ensure_session(&mut session, &session_id, &sessions).await;
                        if let Ok(log) = &outcome {
                            // A reconnect receives the same committed records
                            // available from the REST restore route. The UI can
                            // replace by event_id, so this is safe alongside a
                            // cached HTTP snapshot.
                            for event in &log.events {
                                let Some(recipient) = recipient.as_ref() else { break };
                                if recipient.send(ServerMessage::AgentSessionEvent {
                                    conversation_id: session_id.clone(),
                                    event: event.clone(),
                                }).await.is_err() {
                                    break;
                                }
                            }
                            restore_pending_prompts(log, &recovery_recipient, &mut pending);
                            if let Some(config) = config.as_ref() {
                                start_next_operation(
                                    &session_id, config, &sessions, &tool_context,
                                    &actor_commands, &mut pending, &mut runners,
                                ).await;
                            }
                        }
                        let _ = result.send(outcome.map(|session| session.metadata.clone()));
                    }
                    AiSessionCommand::Prompt {
                        request_id,
                        provider,
                        model_id,
                        prompt,
                        recipient,
                    } => {
                        live_recipient = Some(recipient.clone());
                        let session = match ensure_session(&mut session, &session_id, &sessions)
                            .await
                        {
                            Ok(session) => session,
                            Err(message) => {
                                tracing::error!(session_id, request_id, error = %message, "could not initialize AI session");
                                let _ = recipient
                                    .send(ServerMessage::AgentError {
                                        request_id,
                                        conversation_id: session_id.clone(),
                                        code: Some(AgentFailureCode::SessionUnavailable),
                                        message: user_error().to_owned(),
                                    })
                                    .await;
                                continue;
                            }
                        };
                        if !accept_prompt(&session_id, &request_id, &prompt, &sessions, &recipient).await {
                            let _ = recipient.send(ServerMessage::AgentError { request_id, conversation_id: session_id.clone(), code: Some(AgentFailureCode::StorageWriteFailed), message: user_error().to_owned() }).await;
                            continue;
                        }
                        let operation_id = format!("operation-{request_id}");
                        let Some(config) = config.as_ref() else {
                            send_failure(&session_id, &request_id, AgentFailureCode::MissingModelBackend, "No OpenAI-compatible model backend is configured", &sessions, &recipient).await;
                            continue;
                        };
                        if provider != "openai-compatible" {
                            send_failure(&session_id, &request_id, AgentFailureCode::InvalidProvider, "The selected model provider is not configured", &sessions, &recipient).await;
                            continue;
                        }
                        if model_id.trim().is_empty() || model_id.len() > 256 || prompt.trim().is_empty() || prompt.len() > 100_000 {
                            send_failure(&session_id, &request_id, AgentFailureCode::InvalidPrompt, "The selected model or chat transcript is invalid", &sessions, &recipient).await;
                            continue;
                        }
                        let model = AiSessionModel { provider, model_id };
                        let should_generate_title = session.metadata.title == "New conversation";
                        if session.metadata.model.as_ref() != Some(&model) {
                            if let Err(error) = append_and_publish(&session_id, Some(&operation_id), AiSessionEventKind::ModelSelected { model: model.clone() }, &sessions, &recipient).await {
                                send_failure(&session_id, &request_id, AgentFailureCode::StorageWriteFailed, &error, &sessions, &recipient).await;
                                continue;
                            }
                            session.metadata.model = Some(model.clone());
                        }
                        if should_generate_title {
                            let title_sessions = sessions.clone();
                            let title_commands = actor_commands.clone();
                            let title_recipient = recipient.clone();
                            let title_model = model.clone();
                            let title_prompt = prompt.clone();
                            let title_request_id = request_id.clone();
                            tokio::spawn(async move {
                                let result = title_sessions.generate_title(&title_model, &title_prompt).await;
                                let _ = title_commands.send(AiSessionCommand::TitleGenerated { request_id: title_request_id, result, recipient: title_recipient }).await;
                            });
                        }
                        pending.insert(request_id.clone(), PendingPrompt {
                            model_id: model.model_id,
                            recipient,
                        });
                        start_next_operation(
                            &session_id,
                            config,
                            &sessions,
                            &tool_context,
                            &actor_commands,
                            &mut pending,
                            &mut runners,
                        ).await;
                    }
                    AiSessionCommand::TitleGenerated {
                        request_id,
                        result,
                        recipient,
                    } => {
                        let Some(session) = session.as_mut() else {
                            tracing::error!(
                                session_id,
                                "received AI session title for an unloaded session"
                            );
                            continue;
                        };
                        match result {
                            Ok(Some(title)) => {
                                if let Err(error) = append_and_publish(
                                        &session_id,
                                        None,
                                        AiSessionEventKind::SessionNamed { title: title.clone() },
                                        &sessions,
                                        &recipient,
                                    )
                                    .await
                                {
                                    record_internal_failure(
                                        &session_id,
                                        AgentFailureCode::TitlePersistFailed,
                                        error,
                                        &sessions,
                                        &recipient,
                                    )
                                    .await;
                                    continue;
                                }
                                session.metadata.title = title.clone();
                                let _ = recipient
                                    .send(ServerMessage::AgentSessionNamed {
                                        request_id,
                                        conversation_id: session_id.clone(),
                                        title,
                                    })
                                    .await;
                            }
                            Ok(None) => {
                                tracing::warn!(
                                    session_id,
                                    "model returned no usable AI session title"
                                );
                            }
                            Err(error) => {
                                record_internal_failure(
                                    &session_id,
                                    AgentFailureCode::TitleGenerationFailed,
                                    error,
                                    &sessions,
                                    &recipient,
                                )
                                .await;
                            }
                        }
                    }
                    AiSessionCommand::AgentEvent { event, recipient } => {
                        // A reconnect supersedes the sender captured when the
                        // worker began. The worker itself keeps running.
                        let recipient = live_recipient.clone().unwrap_or(recipient);
                        match event {
                            AgentActorEvent::Started { task } => {
                                let _ = recipient.send(ServerMessage::AgentStarted {
                                    request_id: task.request_id.clone(),
                                    conversation_id: session_id.clone(),
                                }).await;
                            }
                            AgentActorEvent::TextDelta { task, attempt, text } => {
                                let _ = recipient.send(ServerMessage::AgentTextDelta {
                                    request_id: task.request_id.clone(),
                                    conversation_id: session_id.clone(),
                                    message_id: assistant_message_id(&task, attempt),
                                    text,
                                }).await;
                            }
                            AgentActorEvent::ThinkingDelta { task, attempt, text } => {
                                let _ = recipient.send(ServerMessage::AgentThinkingDelta {
                                    request_id: task.request_id.clone(),
                                    conversation_id: session_id.clone(),
                                    reasoning_id: reasoning_message_id(&task, attempt),
                                    text,
                                }).await;
                            }
                            AgentActorEvent::ModelStarted { task, attempt } => {
                                let _ = persist_operation_transition(
                                    &session_id,
                                    &task.operation_id,
                                    &task.request_id,
                                    OperationState::ModelInFlight { attempt },
                                    &sessions,
                                    &recipient,
                                )
                                .await;
                            }
                            AgentActorEvent::ModelSettled { task, attempt, response } => {
                                if let Some(thinking) = response.thinking.filter(|thinking| !thinking.trim().is_empty()) {
                                    if let Err(error) = append_and_publish(&session_id, Some(&task.operation_id), AiSessionEventKind::Reasoning { reasoning_id: Some(reasoning_message_id(&task, attempt)), content: thinking }, &sessions, &recipient).await {
                                        send_failure(&session_id, &task.request_id, AgentFailureCode::StorageWriteFailed, &error, &sessions, &recipient).await;
                                    }
                                }
                                if !response.content.is_empty() {
                                    if let Err(error) = append_and_publish(&session_id, Some(&task.operation_id), AiSessionEventKind::Message { message_id: Some(assistant_message_id(&task, attempt)), role: ChatRole::Assistant, content: response.content, thinking: None, usage: response.usage }, &sessions, &recipient).await {
                                        send_failure(&session_id, &task.request_id, AgentFailureCode::StorageWriteFailed, &error, &sessions, &recipient).await;
                                    }
                                }
                            }
                            AgentActorEvent::ToolCallsProposed { task, calls } => {
                                if !persist_operation_transition(&session_id, &task.operation_id, &task.request_id, OperationState::ToolsPlanned { tool_call_ids: calls.iter().map(|call| call.id.clone()).collect() }, &sessions, &recipient).await { continue; }
                                for call in calls {
                                    let arguments = serde_json::from_str(&call.function.arguments).unwrap_or_else(|_| serde_json::Value::String(call.function.arguments.clone()));
                                    if call.id.trim().is_empty() || call.function.name.trim().is_empty() {
                                        send_failure(&session_id, &task.request_id, AgentFailureCode::ModelStreamFailed, "The model emitted a tool call without a stable ID or name", &sessions, &recipient).await;
                                        break;
                                    }
                                    if let Err(error) = append_and_publish(&session_id, Some(&task.operation_id), AiSessionEventKind::ToolCall { tool_call_id: call.id, name: call.function.name, arguments }, &sessions, &recipient).await {
                                        send_failure(&session_id, &task.request_id, AgentFailureCode::StorageWriteFailed, &error, &sessions, &recipient).await;
                                        break;
                                    }
                                }
                            }
                            AgentActorEvent::ToolStarted { task, call } => {
                                let arguments = serde_json::from_str(&call.function.arguments).unwrap_or_else(|_| serde_json::Value::String(call.function.arguments.clone()));
                                let _ = persist_operation_transition(&session_id, &task.operation_id, &task.request_id, OperationState::ToolInFlight { tool_call_id: call.id.clone() }, &sessions, &recipient).await;
                                let _ = recipient.send(ServerMessage::AgentToolStarted { request_id: task.request_id, conversation_id: session_id.clone(), tool_call_id: call.id, name: call.function.name, arguments }).await;
                            }
                            AgentActorEvent::ToolFinished { task, call_id, result } => {
                                for retry in &result.retry_failures {
                                    let detail = format!(
                                        "tool {call_id} attempt {} failed before retry: {}",
                                        retry.attempt, retry.detail
                                    );
                                    tracing::warn!(session_id, operation_id = task.operation_id, tool_call_id = call_id, attempt = retry.attempt, code = retry.code.as_str(), %detail, "agent tool attempt failed");
                                    if let Err(error) = append_and_publish(&session_id, Some(&task.operation_id), AiSessionEventKind::Failure {
                                        code: retry.code,
                                        message: user_error().to_owned(),
                                        detail: Some(detail),
                                    }, &sessions, &recipient).await {
                                        tracing::error!(session_id, operation_id = task.operation_id, %error, "could not persist agent tool retry failure");
                                    }
                                }
                                if result.is_error {
                                    let detail = format!("tool {call_id} failed: {}", result.content);
                                    tracing::error!(session_id, operation_id = task.operation_id, tool_call_id = call_id, %detail, "agent tool execution failed");
                                    if let Err(error) = append_and_publish(&session_id, Some(&task.operation_id), AiSessionEventKind::Failure {
                                        code: result.failure_code.unwrap_or(AgentFailureCode::ToolExecutionFailed),
                                        message: user_error().to_owned(),
                                        detail: Some(detail),
                                    }, &sessions, &recipient).await {
                                        tracing::error!(session_id, operation_id = task.operation_id, %error, "could not persist agent tool failure");
                                    }
                                }
                                if let Err(error) = append_and_publish(&session_id, Some(&task.operation_id), AiSessionEventKind::ToolResult { tool_call_id: call_id.clone(), content: result.content, is_error: result.is_error }, &sessions, &recipient).await {
                                    send_failure(&session_id, &task.request_id, AgentFailureCode::StorageWriteFailed, &error, &sessions, &recipient).await;
                                }
                                let _ = recipient.send(ServerMessage::AgentToolCompleted { request_id: task.request_id, conversation_id: session_id.clone(), tool_call_id: call_id, is_error: result.is_error }).await;
                            }
                            AgentActorEvent::Completed { task, usage } => {
                                if let Some(usage) = usage { let _ = recipient.send(ServerMessage::AgentUsage { request_id: task.request_id.clone(), conversation_id: session_id.clone(), usage }).await; }
                                let _ = persist_operation_transition(&session_id, &task.operation_id, &task.request_id, OperationState::Completed, &sessions, &recipient).await;
                                runners.remove(&task.request_id);
                                let _ = recipient.send(ServerMessage::AgentCompleted { request_id: task.request_id, conversation_id: session_id.clone() }).await;
                                if let Some(config) = config.as_ref() {
                                    start_next_operation(&session_id, config, &sessions, &tool_context, &actor_commands, &mut pending, &mut runners).await;
                                }
                            }
                            AgentActorEvent::Failed { task, code, detail } => {
                                runners.remove(&task.request_id);
                                send_failure(&session_id, &task.request_id, code, &detail, &sessions, &recipient).await;
                                if let Some(config) = config.as_ref() {
                                    start_next_operation(&session_id, config, &sessions, &tool_context, &actor_commands, &mut pending, &mut runners).await;
                                }
                            }
                            AgentActorEvent::Cancelled { task, partial_text, partial_thinking, attempt, cancelled_tool_call_id } => {
                                runners.remove(&task.request_id);
                                let _ = persist_cancelled_partial(&session_id, &task, attempt, partial_text, partial_thinking, &sessions, &recipient).await;
                                if let Some(tool_call_id) = cancelled_tool_call_id {
                                    if let Err(error) = append_and_publish(
                                        &session_id,
                                        Some(&task.operation_id),
                                        AiSessionEventKind::ToolResult {
                                            tool_call_id,
                                            content: "Tool execution cancelled by user".into(),
                                            is_error: true,
                                        },
                                        &sessions,
                                        &recipient,
                                    )
                                    .await
                                    {
                                        tracing::error!(session_id, operation_id = task.operation_id, %error, "could not persist cancelled tool result");
                                    }
                                }
                                let _ = persist_operation_transition(&session_id, &task.operation_id, &task.request_id, OperationState::Cancelled { reason: "Stopped by user".into() }, &sessions, &recipient).await;
                                if let Some(config) = config.as_ref() {
                                    start_next_operation(&session_id, config, &sessions, &tool_context, &actor_commands, &mut pending, &mut runners).await;
                                }
                            }
                        }
                    }
                    AiSessionCommand::Stop { request_id, recipient } => {
                        if let Some(worker) = runners.remove(&request_id) {
                            worker.stop().await;
                        } else if pending.remove(&request_id).is_some() {
                            let operation_id = format!("operation-{request_id}");
                            let _ = persist_operation_transition(
                                &session_id,
                                &operation_id,
                                &request_id,
                                OperationState::Cancelled { reason: "Stopped by user before execution".into() },
                                &sessions,
                                &recipient,
                            ).await;
                        } else {
                            tracing::warn!(session_id, request_id, "received stop for an unknown AI operation");
                            continue;
                        }
                        let _ = recipient.send(ServerMessage::AgentStopped { request_id, conversation_id: session_id.clone() }).await;
                    }
                }
            }
        });
        Arc::new(Self { commands })
    }

    /// Ensures the durable record exists and loads it before the client starts
    /// using the session. Routes do not perform storage I/O themselves.
    pub async fn start(&self, recipient: mpsc::Sender<ServerMessage>) -> Result<AiSessionMetadata, String> {
        let (result, receiver) = oneshot::channel();
        self.commands
            .send(AiSessionCommand::Start { recipient: Some(recipient), result })
            .await
            .map_err(|_| "The AI session is unavailable".to_owned())?;
        receiver
            .await
            .map_err(|_| "The AI session is unavailable".to_owned())?
    }

    /// Resume durable unfinished operations after server boot. This does not
    /// require a browser; a later `start` replaces the detached recipient.
    pub async fn recover(&self) -> Result<(), ()> {
        let (result, receiver) = oneshot::channel();
        self.commands.send(AiSessionCommand::Start { recipient: None, result }).await.map_err(|_| ())?;
        receiver.await.map(|_| ()).map_err(|_| ())
    }

    pub async fn prompt(
        &self,
        request_id: String,
        provider: String,
        model_id: String,
        prompt: String,
        recipient: mpsc::Sender<ServerMessage>,
    ) -> Result<(), ()> {
        self.commands
            .send(AiSessionCommand::Prompt {
                request_id,
                provider,
                model_id,
                prompt,
                recipient,
            })
            .await
            .map_err(|_| ())
    }

    pub async fn stop(&self, request_id: String, recipient: mpsc::Sender<ServerMessage>) -> Result<(), ()> {
        self.commands.send(AiSessionCommand::Stop { request_id, recipient }).await.map_err(|_| ())
    }
}

/// Acceptance is intentionally separate from execution. A prompt is durable
/// and visible as soon as the actor receives it, even while another operation
/// owns the model/tool execution permit.
async fn accept_prompt(
    session_id: &str,
    request_id: &str,
    prompt: &str,
    sessions: &AiSessionService,
    recipient: &mpsc::Sender<ServerMessage>,
) -> bool {
    let operation_id = format!("operation-{request_id}");
    if !persist_operation_transition(session_id, &operation_id, request_id, OperationState::Accepted, sessions, recipient).await {
        return false;
    }
    match append_and_publish(
        session_id,
        Some(&operation_id),
        AiSessionEventKind::UserMessageQueued { content: prompt.to_owned() },
        sessions,
        recipient,
    ).await {
        Ok(_) => true,
        Err(error) => {
            tracing::error!(session_id, request_id, %error, "could not persist accepted AI prompt");
            false
        }
    }
}

/// Claims the oldest durably accepted prompt only when no agent owns the
/// session execution lease. Context is built here—not at acceptance—so every
/// queued turn sees all completed earlier turns and none of the future ones.
fn restore_pending_prompts(
    log: &AgentSessionLog,
    recipient: &mpsc::Sender<ServerMessage>,
    pending: &mut HashMap<String, PendingPrompt>,
) {
    let Some(model) = log.metadata.model.as_ref() else {
        tracing::warn!(session_id = log.metadata.id, "cannot recover AI work without its selected model");
        return;
    };
    for operation in log.operations.iter().filter(|operation| {
        matches!(operation.status, OperationStatus::Pending | OperationStatus::Waiting)
    }) {
        pending.entry(operation.request_id.clone()).or_insert_with(|| PendingPrompt {
            model_id: model.model_id.clone(),
            recipient: recipient.clone(),
        });
    }
}

async fn start_next_operation(
    session_id: &str,
    config: &OpenAiCompatibleConfig,
    sessions: &Arc<AiSessionService>,
    tool_context: &ToolContext,
    commands: &mpsc::Sender<AiSessionCommand>,
    pending: &mut HashMap<String, PendingPrompt>,
    runners: &mut HashMap<String, Arc<AgentActor>>,
) {
    if !runners.is_empty() {
        return;
    }
    let Some(log) = sessions.get(session_id) else {
        tracing::error!(session_id, "could not schedule a missing AI session");
        return;
    };
    let Some(operation) = log
        .operations
        .iter()
        .filter(|operation| matches!(operation.status, OperationStatus::Pending | OperationStatus::Waiting))
        .filter(|operation| pending.contains_key(&operation.request_id))
        .min_by_key(|operation| operation.operation_sequence)
    else {
        return;
    };
    let operation_id = operation.operation_id.clone();
    let request_id = operation.request_id.clone();
    let was_waiting = operation.status == OperationStatus::Waiting;
    let Some(pending_prompt) = pending.remove(&request_id) else { return };
    let Some(prompt) = log.events.iter().find_map(|event| {
        (event.operation_id.as_deref() == Some(operation_id.as_str())).then(|| match &event.kind {
            AiSessionEventKind::UserMessageQueued { content } => Some(content.clone()),
            _ => None,
        }).flatten()
    }) else {
        send_failure(session_id, &request_id, AgentFailureCode::StorageWriteFailed, "The accepted prompt is missing from the durable log", sessions, &pending_prompt.recipient).await;
        return;
    };
    let already_visible = log.events.iter().any(|event| {
        event.operation_id.as_deref() == Some(operation_id.as_str())
            && matches!(&event.kind, AiSessionEventKind::Message { role: ChatRole::User, .. })
    });
    if !already_visible {
        if let Err(error) = append_and_publish(session_id, Some(&operation_id), AiSessionEventKind::Message {
            message_id: None,
            role: ChatRole::User,
            content: prompt,
            thinking: None,
            usage: None,
        }, sessions, &pending_prompt.recipient).await {
            send_failure(session_id, &request_id, AgentFailureCode::StorageWriteFailed, &error, sessions, &pending_prompt.recipient).await;
            return;
        }
    }
    if !persist_operation_transition(session_id, &operation_id, &request_id, OperationState::Preparing, sessions, &pending_prompt.recipient).await {
        return;
    }
    let Some(log) = sessions.get(session_id) else {
        send_failure(session_id, &request_id, AgentFailureCode::StorageWriteFailed, "The claimed operation could not be reloaded", sessions, &pending_prompt.recipient).await;
        return;
    };
    let projection = AgentProjection::from_log(&log);
    let context = projection.model_context(&log, &operation_id);
    let resume_tool_calls = if was_waiting {
        projection.pending_tool_calls.iter().filter(|call| call.operation_id == operation_id).map(|call| OpenAiToolCall {
            id: call.tool_call_id.clone(),
            kind: "function".into(),
            function: OpenAiToolCallFunction { name: call.name.clone(), arguments: call.arguments.to_string() },
        }).collect()
    } else { Vec::new() };
    let (events, mut event_receiver) = mpsc::channel(64);
    let worker = AgentActor::spawn(config.clone(), ToolRegistry::read_only(), tool_context.clone(), events);
    let forward_commands = commands.clone();
    let forward_recipient = pending_prompt.recipient.clone();
    tokio::spawn(async move {
        while let Some(event) = event_receiver.recv().await {
            if forward_commands.send(AiSessionCommand::AgentEvent { event, recipient: forward_recipient.clone() }).await.is_err() {
                break;
            }
        }
    });
    if worker.run_turn(AgentTask {
        session_id: session_id.to_owned(),
        operation_id,
        request_id: request_id.clone(),
        model_id: pending_prompt.model_id,
        context,
        resume_tool_calls,
    }).await.is_err() {
        send_failure(session_id, &request_id, AgentFailureCode::AgentExecutionFailed, "The agent worker could not be started", sessions, &pending_prompt.recipient).await;
        return;
    }
    runners.insert(request_id, worker);
}

async fn persist_operation_transition(
    session_id: &str,
    operation_id: &str,
    request_id: &str,
    state: OperationState,
    sessions: &AiSessionService,
    recipient: &mpsc::Sender<ServerMessage>,
) -> bool {
    let transition = OperationTransition {
        operation_id: operation_id.to_owned(),
        request_id: request_id.to_owned(),
        state,
        occurred_at_ms: now_ms(),
    };
    match append_and_publish(
        session_id,
        Some(operation_id),
        AiSessionEventKind::OperationTransition { transition },
        sessions,
        recipient,
    ).await
    {
        Ok(_) => true,
        Err(error) => {
            tracing::error!(session_id, operation_id, request_id, %error, "could not persist AI operation transition");
            false
        }
    }
}

/// The actor that owns the session is the only durable writer. Publishing only
/// happens after `append` acknowledges the JSONL record, making the event sent
/// to a client safe to reconcile by its stable ID and sequence.
async fn append_and_publish(
    session_id: &str,
    operation_id: Option<&str>,
    kind: AiSessionEventKind,
    sessions: &AiSessionService,
    recipient: &mpsc::Sender<ServerMessage>,
) -> Result<AiSessionEvent, String> {
    let event = sessions.append(session_id, operation_id, kind).await?;
    if recipient
        .send(ServerMessage::AgentSessionEvent {
            conversation_id: session_id.to_owned(),
            event: event.clone(),
        })
        .await
        .is_err()
    {
        tracing::debug!(session_id, event_id = event.event_id, "AI session event recipient disconnected");
    }
    Ok(event)
}

async fn persist_cancelled_partial(
    session_id: &str,
    task: &AgentTask,
    attempt: Option<u32>,
    partial_text: String,
    partial_thinking: String,
    sessions: &AiSessionService,
    recipient: &mpsc::Sender<ServerMessage>,
) -> bool {
    if !partial_thinking.trim().is_empty()
        && append_and_publish(
            session_id,
            Some(&task.operation_id),
            AiSessionEventKind::Reasoning {
                reasoning_id: attempt.map(|attempt| reasoning_message_id(task, attempt)),
                content: partial_thinking,
            },
            sessions,
            recipient,
        )
        .await
        .is_err()
    {
        return false;
    }
    if !partial_text.trim().is_empty()
        && append_and_publish(
            session_id,
            Some(&task.operation_id),
            AiSessionEventKind::Message {
                message_id: attempt.map(|attempt| assistant_message_id(task, attempt)),
                role: ChatRole::Assistant,
                content: partial_text.trim_start().to_owned(),
                thinking: None,
                usage: None,
            },
            sessions,
            recipient,
        )
        .await
        .is_err()
    {
        return false;
    }
    true
}

fn assistant_message_id(task: &AgentTask, attempt: u32) -> String {
    format!("{}:assistant:{attempt}", task.operation_id)
}

fn reasoning_message_id(task: &AgentTask, attempt: u32) -> String {
    format!("{}:reasoning:{attempt}", task.operation_id)
}

async fn send_failure(
    session_id: &str,
    request_id: &str,
    code: AgentFailureCode,
    detail: &str,
    sessions: &AiSessionService,
    recipient: &mpsc::Sender<ServerMessage>,
) {
    let operation_id = format!("operation-{request_id}");
    tracing::error!(session_id, request_id, code = code.as_str(), detail, "AI session operation failed");
    if let Err(storage_error) = append_and_publish(
            session_id,
            Some(&operation_id),
            AiSessionEventKind::Failure {
                code,
                message: user_error().to_owned(),
                detail: Some(detail.to_owned()),
            },
            sessions,
            recipient,
        )
        .await
    {
        tracing::error!(session_id, request_id, code = code.as_str(), error = %storage_error, "could not persist AI session failure");
    }
    let _ = persist_operation_transition(session_id, &operation_id, request_id, OperationState::Failed, sessions, recipient).await;
    let _ = recipient.send(ServerMessage::AgentError {
        request_id: request_id.to_owned(),
        conversation_id: session_id.to_owned(),
        code: Some(code),
        message: user_error().to_owned(),
    }).await;
}

async fn record_internal_failure(
    session_id: &str,
    code: AgentFailureCode,
    detail: String,
    sessions: &AiSessionService,
    recipient: &mpsc::Sender<ServerMessage>,
) {
    tracing::error!(session_id, code = code.as_str(), detail, "AI session background task failed");
    if let Err(storage_error) = append_and_publish(session_id, None, AiSessionEventKind::Failure {
            code,
            message: user_error().to_owned(),
            detail: Some(detail),
        }, sessions, recipient)
        .await
    {
        tracing::error!(session_id, code = code.as_str(), error = %storage_error, "could not persist AI session background failure");
    }
}

const fn user_error() -> &'static str {
    "Something went wrong. Please try again."
}

async fn ensure_session<'a>(
    session: &'a mut Option<AgentSessionLog>,
    session_id: &str,
    sessions: &AiSessionService,
) -> Result<&'a mut AgentSessionLog, String> {
    if session.is_none() {
        *session = Some(sessions.open_or_create(session_id).await?);
    }
    Ok(session.as_mut().expect("session was initialized"))
}

pub(crate) async fn stream_openai_compatible(
    config: &OpenAiCompatibleConfig,
    model_id: &str,
    messages: &[OpenAiChatMessage],
    tools: &ToolRegistry,
    sender: mpsc::Sender<AgentStreamDelta>,
) -> Result<AssistantResponse, String> {
    let endpoint = chat_completions_endpoint(&config.base_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "The model client could not be initialized".to_owned())?;
    let response = client
        .post(endpoint)
        .bearer_auth(config.api_key())
        .json(&ChatCompletionRequest {
            model: model_id.to_owned(),
            messages: messages.to_vec(),
            stream: true,
            tools: Some(tools.definitions()),
            chat_template_kwargs: None,
            stream_options: Some(crate::models::OpenAiStreamOptions {
                include_usage: true,
            }),
        })
        .send()
        .await
        .map_err(|_| "The configured model backend could not be reached".to_owned())?;
    if !response.status().is_success() {
        return Err("The configured model backend rejected the chat request".into());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut response_text = String::new();
    let mut thinking = String::new();
    let mut tool_calls = Vec::new();
    let mut usage = None;
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| format!("The model response stream was interrupted {:?}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(event) = take_event(&mut buffer) {
            if event == "[DONE]" {
                return Ok(AssistantResponse {
                    content: response_text.trim().to_owned(),
                    thinking: (!thinking.trim().is_empty()).then(|| thinking.trim().to_owned()),
                    tool_calls,
                    usage,
                });
            }
            let chunk: ChatCompletionChunk = serde_json::from_str(&event).map_err(|e| {
                format!("The model backend returned an invalid stream event {:?}", e)
            })?;
            if let Some(chunk_usage) = chunk.usage {
                usage = Some(chunk_usage.into());
            }
            for choice in chunk.choices {
                if let Some(reasoning) = choice
                    .delta
                    .reasoning
                    .or(choice.delta.reasoning_content)
                    .filter(|reasoning| !reasoning.is_empty())
                {
                    thinking.push_str(&reasoning);
                    if sender.send(AgentStreamDelta::Thinking(reasoning)).await.is_err() {
                        return Ok(AssistantResponse::new(response_text, thinking));
                    }
                }
                if let Some(text) = choice.delta.content.filter(|text| !text.is_empty()) {
                    let text = if response_text.is_empty() {
                        text.trim_start().to_owned()
                    } else {
                        text
                    };
                    if text.is_empty() {
                        continue;
                    }
                    response_text.push_str(&text);
                    if sender.send(AgentStreamDelta::Text(text)).await.is_err() {
                        return Ok(AssistantResponse::new(response_text, thinking));
                    }
                }
                for delta in choice.delta.tool_calls {
                    while tool_calls.len() <= delta.index {
                        tool_calls.push(OpenAiToolCall {
                            id: String::new(),
                            kind: "function",
                            function: OpenAiToolCallFunction {
                                name: String::new(),
                                arguments: String::new(),
                            },
                        });
                    }
                    let call = &mut tool_calls[delta.index];
                    if let Some(id) = delta.id {
                        call.id = id;
                    }
                    if let Some(function) = delta.function {
                        if let Some(name) = function.name {
                            call.function.name = name;
                        }
                        if let Some(arguments) = function.arguments {
                            call.function.arguments.push_str(&arguments);
                        }
                    }
                }
            }
        }
    }
    Err("The model response stream ended before completion".to_owned())
}

fn chat_completions_endpoint(base_url: &str) -> Result<reqwest::Url, String> {
    let base_url = format!("{}/", base_url.trim_end_matches('/'));
    reqwest::Url::parse(&base_url)
        .and_then(|base_url| base_url.join("chat/completions"))
        .map_err(|_| "OPENAI_API_BASE_URL is invalid".to_owned())
}

fn take_event(buffer: &mut String) -> Option<String> {
    let delimiter = buffer.find("\n\n")?;
    let event = buffer.drain(..delimiter + 2).collect::<String>();
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n");
    (!data.is_empty()).then_some(data)
}

#[cfg(test)]
mod tests {
    use super::{AiSessionActor, chat_completions_endpoint, take_event};
    use crate::{
        models::{AssistantResponse, ServerMessage},
        services::ai_session::AiSessionService,
    };
    use std::sync::Arc;
    use tokio::{sync::mpsc, time::Duration};

    #[tokio::test]
    async fn unconfigured_actor_reports_a_scoped_error() {
        let sessions_dir =
            std::env::temp_dir().join(format!("forge-ai-session-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&sessions_dir).await.unwrap();
        let sessions = Arc::new(AiSessionService::new(sessions_dir.clone(), None).unwrap());
        let actor = AiSessionActor::spawn(
            "conversation-1".into(),
            None,
            sessions,
            crate::agent::tools::ToolContext::new(Default::default(), Default::default()),
        );
        let (sender, mut receiver) = mpsc::channel(1);
        actor
            .prompt(
                "request-1".into(),
                "openai-compatible".into(),
                "model-1".into(),
                "Hello".into(),
                sender,
            )
            .await
            .unwrap();
        let event = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let event = receiver.recv().await.expect("actor response");
                if matches!(event, ServerMessage::AgentError { .. }) {
                    return event;
                }
            }
        })
        .await
        .unwrap();
        assert!(matches!(
            event,
            ServerMessage::AgentError {
                request_id,
                conversation_id,
                ..
            } if request_id == "request-1" && conversation_id == "conversation-1"
        ));
        tokio::fs::remove_dir_all(sessions_dir).await.unwrap();
    }

    #[test]
    fn completion_endpoint_preserves_the_configured_api_path() {
        assert_eq!(
            chat_completions_endpoint("https://models.example.test/v1")
                .unwrap()
                .as_str(),
            "https://models.example.test/v1/chat/completions"
        );
    }

    #[test]
    fn extracts_one_sse_event_without_consuming_the_next() {
        let mut buffer = "data: {\"choices\": []}\n\ndata: [DONE]\n\n".to_owned();
        assert_eq!(
            take_event(&mut buffer).as_deref(),
            Some("{\"choices\": []}")
        );
        assert_eq!(take_event(&mut buffer).as_deref(), Some("[DONE]"));
    }

    #[test]
    fn trims_assistant_content_and_retains_thinking() {
        let response = AssistantResponse::new(
            "\n\n  The fix is ready.\n".into(),
            "\n first inspect the state \n".into(),
        );
        assert_eq!(response.content, "The fix is ready.");
        assert_eq!(
            response.thinking.as_deref(),
            Some("first inspect the state")
        );
    }
}
