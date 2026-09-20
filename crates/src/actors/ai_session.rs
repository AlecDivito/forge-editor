use std::{sync::Arc, time::Duration};

use futures_util::StreamExt;
use tokio::sync::{mpsc, oneshot};

use crate::{
    config::OpenAiCompatibleConfig,
    models::{
        AI_SESSION_RECORD_VERSION, AiSession, AiSessionMetadata, AiSessionModel, AiSessionRecord,
        ChatCompletionChunk, ChatCompletionRequest, ChatMessage, ChatRole, OpenAiChatMessage,
        ServerMessage,
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
}

impl AiSessionActor {
    pub fn spawn(
        session_id: String,
        config: Option<OpenAiCompatibleConfig>,
        sessions: Arc<AiSessionService>,
    ) -> Arc<Self> {
        let (commands, mut receiver) = mpsc::channel(8);
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
                        let session =
                            match ensure_session(&mut session, &session_id, &sessions).await {
                                Ok(session) => session,
                                Err(message) => {
                                    let _ = recipient
                                        .send(ServerMessage::AgentError {
                                            request_id,
                                            conversation_id: session_id.clone(),
                                            message,
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
                            &sessions,
                            recipient,
                        )
                        .await;
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
    sessions: &AiSessionService,
    recipient: mpsc::Sender<ServerMessage>,
) {
    let failure = |message: &str| ServerMessage::AgentError {
        request_id: request_id.clone(),
        conversation_id: session_id.to_owned(),
        message: message.to_owned(),
    };
    if provider != "openai-compatible" {
        recipient
            .send(failure("The selected model provider is not configured"))
            .await
            .ok();
        return;
    }
    let Some(config) = config else {
        recipient
            .send(failure("No OpenAI-compatible model backend is configured"))
            .await
            .ok();
        return;
    };
    if model_id.trim().is_empty()
        || model_id.len() > 256
        || prompt.trim().is_empty()
        || prompt.len() > 100_000
    {
        recipient
            .send(failure("The selected model or chat transcript is invalid"))
            .await
            .ok();
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
        recipient
            .send(failure("The in-memory chat transcript exceeds its limit"))
            .await
            .ok();
        return;
    }

    let model = AiSessionModel { provider, model_id };
    if session.metadata.title == "New conversation" {
        let title = sessions.generate_title(&model, &prompt).await;
        match sessions
            .append(
                session_id,
                AiSessionRecord::SessionNamed {
                    version: AI_SESSION_RECORD_VERSION,
                    title: title.clone(),
                    updated_at_ms: now_ms(),
                },
            )
            .await
        {
            Ok(()) => {}
            Err(message) => {
                recipient.send(failure(&message)).await.ok();
                return;
            }
        }
        session.metadata.title = title;
    }

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
                recipient.send(failure(&message)).await.ok();
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
                created_at_ms: now_ms(),
            },
        )
        .await
    {
        Ok(()) => {}
        Err(message) => {
            recipient.send(failure(&message)).await.ok();
            return;
        }
    }
    session.messages.push(crate::models::ChatMessage {
        role: ChatRole::User,
        content: prompt,
    });
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
            if !response.is_empty() {
                if let Err(message) = sessions
                    .append(
                        session_id,
                        AiSessionRecord::Message {
                            version: AI_SESSION_RECORD_VERSION,
                            role: ChatRole::Assistant,
                            content: response.clone(),
                            created_at_ms: now_ms(),
                        },
                    )
                    .await
                {
                    recipient.send(failure(&message)).await.ok();
                    return;
                }
                session.messages.push(crate::models::ChatMessage {
                    role: ChatRole::Assistant,
                    content: response,
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
            recipient
                .send(ServerMessage::AgentError {
                    request_id,
                    conversation_id: session_id.to_owned(),
                    message,
                })
                .await
                .ok();
        }
    }
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
) -> Result<String, String> {
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
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "The model response stream was interrupted".to_owned())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(event) = take_event(&mut buffer) {
            if event == "[DONE]" {
                return Ok(response_text);
            }
            let chunk: ChatCompletionChunk = serde_json::from_str(&event)
                .map_err(|_| "The model backend returned an invalid stream event".to_owned())?;
            for choice in chunk.choices {
                if let Some(text) = choice.delta.content.filter(|text| !text.is_empty()) {
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
                        return Ok(response_text);
                    }
                }
            }
        }
    }
    Ok(response_text)
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
    use crate::{models::ServerMessage, services::ai_session::AiSessionService};
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
}
