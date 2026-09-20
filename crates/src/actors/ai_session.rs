use std::{sync::Arc, time::Duration};

use futures_util::StreamExt;
use tokio::sync::{mpsc, oneshot};

use crate::{
    agent::error::AgentFailureCode,
    config::OpenAiCompatibleConfig,
    models::{
        AI_SESSION_RECORD_VERSION, AiSession, AiSessionMetadata, AiSessionModel, AiSessionRecord,
        AssistantResponse, ChatCompletionChunk, ChatCompletionRequest, ChatMessage, ChatRole,
        OpenAiChatMessage, ServerMessage,
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
}

impl AiSessionActor {
    pub fn spawn(
        session_id: String,
        config: Option<OpenAiCompatibleConfig>,
        sessions: Arc<AiSessionService>,
    ) -> Arc<Self> {
        let (commands, mut receiver) = mpsc::channel(8);
        let actor_commands = commands.clone();
        tokio::spawn(async move {
            let mut session = None;
            while let Some(command) = receiver.recv().await {
                match command {
                    AiSessionCommand::Start { result } => {
                        let outcome = ensure_session(&mut session, &session_id, &sessions).await;
                        let _ = result.send(outcome.map(|session| session.metadata.clone()));
                    }
                    AiSessionCommand::Prompt {
                        request_id,
                        provider,
                        model_id,
                        prompt,
                        recipient,
                    } => {
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
                                        message: user_error().to_owned(),
                                    })
                                    .await;
                                continue;
                            }
                        };
                        run_prompt(
                            &session_id,
                            config.as_ref(),
                            request_id,
                            provider,
                            model_id,
                            prompt,
                            session,
                            sessions.clone(),
                            recipient,
                            actor_commands.clone(),
                        )
                        .await;
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
                                if let Err(error) = sessions
                                    .append(
                                        &session_id,
                                        AiSessionRecord::SessionNamed {
                                            version: AI_SESSION_RECORD_VERSION,
                                            title: title.clone(),
                                            updated_at_ms: now_ms(),
                                        },
                                    )
                                    .await
                                {
                                    record_internal_failure(
                                        &session_id,
                                        AgentFailureCode::TitlePersistFailed,
                                        error,
                                        &sessions,
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
                                )
                                .await;
                            }
                        }
                    }
                }
            }
        });
        Arc::new(Self { commands })
    }

    /// Ensures the durable record exists and loads it before the client starts
    /// using the session. Routes do not perform storage I/O themselves.
    pub async fn start(&self) -> Result<AiSessionMetadata, String> {
        let (result, receiver) = oneshot::channel();
        self.commands
            .send(AiSessionCommand::Start { result })
            .await
            .map_err(|_| "The AI session is unavailable".to_owned())?;
        receiver
            .await
            .map_err(|_| "The AI session is unavailable".to_owned())?
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
}

async fn run_prompt(
    session_id: &str,
    config: Option<&OpenAiCompatibleConfig>,
    request_id: String,
    provider: String,
    model_id: String,
    prompt: String,
    session: &mut AiSession,
    sessions: Arc<AiSessionService>,
    recipient: mpsc::Sender<ServerMessage>,
    commands: mpsc::Sender<AiSessionCommand>,
) {
    if provider != "openai-compatible" {
        send_failure(
            session_id,
            &request_id,
            AgentFailureCode::InvalidProvider,
            "The selected model provider is not configured",
            &sessions,
            &recipient,
        )
        .await;
        return;
    }
    let Some(config) = config else {
        send_failure(
            session_id,
            &request_id,
            AgentFailureCode::MissingModelBackend,
            "No OpenAI-compatible model backend is configured",
            &sessions,
            &recipient,
        )
        .await;
        return;
    };
    if model_id.trim().is_empty()
        || model_id.len() > 256
        || prompt.trim().is_empty()
        || prompt.len() > 100_000
    {
        send_failure(
            session_id,
            &request_id,
            AgentFailureCode::InvalidPrompt,
            "The selected model or chat transcript is invalid",
            &sessions,
            &recipient,
        )
        .await;
        return;
    }

    if recipient
        .send(ServerMessage::AgentStarted {
            request_id: request_id.clone(),
            conversation_id: session_id.to_owned(),
        })
        .await
        .is_err()
    {
        return;
    }
    let prospective_message_bytes = session
        .messages
        .iter()
        .map(|message| message.content.len())
        .sum::<usize>()
        + prompt.len();
    if session.messages.len() >= 100 || prospective_message_bytes > 100_000 {
        send_failure(
            session_id,
            &request_id,
            AgentFailureCode::TranscriptLimit,
            "The in-memory chat transcript exceeds its limit",
            &sessions,
            &recipient,
        )
        .await;
        return;
    }

    let model = AiSessionModel { provider, model_id };
    let should_generate_title = sessions
        .get(session_id)
        .is_some_and(|session| session.metadata.title == "New conversation");

    if session.metadata.model.as_ref() != Some(&model) {
        match sessions
            .append(
                session_id,
                AiSessionRecord::ModelSelected {
                    version: AI_SESSION_RECORD_VERSION,
                    model: model.clone(),
                    updated_at_ms: now_ms(),
                },
            )
            .await
        {
            Ok(()) => {}
            Err(message) => {
                send_failure(
                    session_id,
                    &request_id,
                    AgentFailureCode::StorageWriteFailed,
                    &message,
                    &sessions,
                    &recipient,
                )
                .await;
                return;
            }
        }
        session.metadata.model = Some(model.clone());
    }
    match sessions
        .append(
            session_id,
            AiSessionRecord::Message {
                version: AI_SESSION_RECORD_VERSION,
                role: ChatRole::User,
                content: prompt.clone(),
                thinking: None,
                created_at_ms: now_ms(),
            },
        )
        .await
    {
        Ok(()) => {}
        Err(message) => {
            send_failure(
                session_id,
                &request_id,
                AgentFailureCode::StorageWriteFailed,
                &message,
                &sessions,
                &recipient,
            )
            .await;
            return;
        }
    }
    session.messages.push(ChatMessage {
        role: ChatRole::User,
        content: prompt.clone(),
        thinking: None,
    });
    if should_generate_title {
        let title_request_id = request_id.clone();
        let title_model = model.clone();
        let title_prompt = prompt.clone();
        let title_sessions = sessions.clone();
        let title_recipient = recipient.clone();
        tokio::spawn(async move {
            let result = title_sessions
                .generate_title(&title_model, &title_prompt)
                .await;
            if commands
                .send(AiSessionCommand::TitleGenerated {
                    request_id: title_request_id,
                    result,
                    recipient: title_recipient,
                })
                .await
                .is_err()
            {
                tracing::error!(
                    "AI session actor stopped before a generated title could be handled"
                );
            }
        });
    }
    match stream_openai_compatible(
        config,
        &model.model_id,
        &session.messages,
        session_id,
        &request_id,
        recipient.clone(),
    )
    .await
    {
        Ok(response) => {
            if !response.content.is_empty() || response.thinking.is_some() {
                if let Err(message) = sessions
                    .append(
                        session_id,
                        AiSessionRecord::Message {
                            version: AI_SESSION_RECORD_VERSION,
                            role: ChatRole::Assistant,
                            content: response.content.clone(),
                            thinking: response.thinking.clone(),
                            created_at_ms: now_ms(),
                        },
                    )
                    .await
                {
                    send_failure(
                        session_id,
                        &request_id,
                        AgentFailureCode::StorageWriteFailed,
                        &message,
                        &sessions,
                        &recipient,
                    )
                    .await;
                    return;
                }
                session.messages.push(ChatMessage {
                    role: ChatRole::Assistant,
                    content: response.content,
                    thinking: response.thinking,
                });
            }
            recipient
                .send(ServerMessage::AgentCompleted {
                    request_id,
                    conversation_id: session_id.to_owned(),
                })
                .await
                .ok();
        }
        Err(message) => {
            send_failure(
                session_id,
                &request_id,
                AgentFailureCode::ModelStreamFailed,
                &message,
                &sessions,
                &recipient,
            )
            .await;
        }
    }
}

async fn send_failure(
    session_id: &str,
    request_id: &str,
    code: AgentFailureCode,
    detail: &str,
    sessions: &AiSessionService,
    recipient: &mpsc::Sender<ServerMessage>,
) {
    tracing::error!(
        session_id,
        request_id,
        code = code.as_str(),
        detail,
        "AI session operation failed"
    );
    if let Err(storage_error) = sessions
        .append(
            session_id,
            AiSessionRecord::Failure {
                version: AI_SESSION_RECORD_VERSION,
                code,
                message: user_error().to_owned(),
                detail: Some(detail.to_owned()),
                created_at_ms: now_ms(),
            },
        )
        .await
    {
        tracing::error!(session_id, request_id, code = code.as_str(), error = %storage_error, "could not persist AI session failure");
    }
    recipient
        .send(ServerMessage::AgentError {
            request_id: request_id.to_owned(),
            conversation_id: session_id.to_owned(),
            message: user_error().to_owned(),
        })
        .await
        .ok();
}

async fn record_internal_failure(
    session_id: &str,
    code: AgentFailureCode,
    detail: String,
    sessions: &AiSessionService,
) {
    tracing::error!(
        session_id,
        code = code.as_str(),
        detail,
        "AI session background task failed"
    );
    if let Err(storage_error) = sessions
        .append(
            session_id,
            AiSessionRecord::Failure {
                version: AI_SESSION_RECORD_VERSION,
                code,
                message: user_error().to_owned(),
                detail: Some(detail),
                created_at_ms: now_ms(),
            },
        )
        .await
    {
        tracing::error!(session_id, code = code.as_str(), error = %storage_error, "could not persist AI session background failure");
    }
}

const fn user_error() -> &'static str {
    "Something went wrong. Please try again."
}

async fn ensure_session<'a>(
    session: &'a mut Option<AiSession>,
    session_id: &str,
    sessions: &AiSessionService,
) -> Result<&'a mut AiSession, String> {
    if session.is_none() {
        *session = Some(sessions.open_or_create(session_id).await?);
    }
    Ok(session.as_mut().expect("session was initialized"))
}

async fn stream_openai_compatible(
    config: &OpenAiCompatibleConfig,
    model_id: &str,
    messages: &[ChatMessage],
    conversation_id: &str,
    request_id: &str,
    sender: mpsc::Sender<ServerMessage>,
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
            messages: messages
                .iter()
                .map(|message| OpenAiChatMessage {
                    role: match message.role {
                        ChatRole::User => "user",
                        ChatRole::Assistant => "assistant",
                    },
                    content: message.content.clone(),
                })
                .collect(),
            stream: true,
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
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| format!("The model response stream was interrupted {:?}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(event) = take_event(&mut buffer) {
            if event == "[DONE]" {
                return Ok(AssistantResponse::new(response_text, thinking));
            }
            let chunk: ChatCompletionChunk = serde_json::from_str(&event).map_err(|e| {
                format!("The model backend returned an invalid stream event {:?}", e)
            })?;
            for choice in chunk.choices {
                if let Some(reasoning) = choice
                    .delta
                    .reasoning
                    .or(choice.delta.reasoning_content)
                    .filter(|reasoning| !reasoning.is_empty())
                {
                    thinking.push_str(&reasoning);
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
                    if sender
                        .send(ServerMessage::AgentTextDelta {
                            conversation_id: conversation_id.to_owned(),
                            request_id: request_id.to_owned(),
                            text,
                        })
                        .await
                        .is_err()
                    {
                        return Ok(AssistantResponse::new(response_text, thinking));
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
        let actor = AiSessionActor::spawn("conversation-1".into(), None, sessions);
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
        let event = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
            .await
            .unwrap()
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
