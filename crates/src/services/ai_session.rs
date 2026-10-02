use std::path::PathBuf;

use anyhow::Context;
use dashmap::DashMap;
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    agent::session::writer::SessionWriter,
    config::OpenAiCompatibleConfig,
    models::{
        AI_SESSION_RECORD_VERSION, AgentSessionLog, AiSessionEvent,
        AiSessionEventKind, AiSessionMetadata, AiSessionModel, AiSessionRecord,
        AiSessionSummary, ChatCompletionRequest, OpenAiChatMessage,
    },
    util::time::now_ms,
};

const DEFAULT_SESSION_TITLE: &str = "New conversation";

/// Process-wide index and durable store for AI sessions.
///
/// It is initialized from every JSONL file before the server begins accepting
/// requests. Session actors remain the only writers for a live conversation;
/// this service owns storage and the frontend-facing read model.
#[derive(Debug)]
pub struct AiSessionService {
    sessions_dir: PathBuf,
    sessions: DashMap<String, AgentSessionLog>,
    writers: DashMap<String, std::sync::Arc<SessionWriter>>,
    model_backend: Option<OpenAiCompatibleConfig>,
}

impl AiSessionService {
    pub fn new(
        sessions_dir: PathBuf,
        model_backend: Option<OpenAiCompatibleConfig>,
    ) -> anyhow::Result<Self> {
        let service = Self {
            sessions_dir,
            sessions: DashMap::new(),
            writers: DashMap::new(),
            model_backend,
        };
        service.load_sessions()?;
        Ok(service)
    }

    pub fn list(&self, query: Option<&str>) -> Vec<AiSessionSummary> {
        let query = query.map(str::trim).filter(|query| !query.is_empty());
        let mut sessions = self
            .sessions
            .iter()
            .filter(|entry| matches_query(entry.value(), query))
            .map(|entry| AiSessionSummary {
                metadata: entry.metadata.clone(),
                message_count: entry.message_count(),
            })
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| {
            right
                .metadata
                .created_at_ms
                .cmp(&left.metadata.created_at_ms)
                .then_with(|| left.metadata.id.cmp(&right.metadata.id))
        });
        sessions
    }

    pub fn get(&self, session_id: &str) -> Option<AgentSessionLog> {
        self.sessions.get(session_id).map(|session| session.clone())
    }

    pub async fn open_or_create(&self, session_id: &str) -> Result<AgentSessionLog, String> {
        if let Some(session) = self.get(session_id) {
            return Ok(session);
        }
        self.session_path(session_id)?;
        let metadata = AiSessionMetadata {
            id: session_id.to_owned(),
            title: DEFAULT_SESSION_TITLE.to_owned(),
            created_at_ms: now_ms(),
            model: None,
        };
        let mut session = AgentSessionLog {
            metadata: metadata.clone(),
            operations: Vec::new(),
            events: Vec::new(),
        };
        let created = AiSessionEvent {
            event_id: Uuid::new_v4().to_string(),
            sequence: 1,
            operation_id: None,
            operation_sequence: None,
            occurred_at_ms: metadata.created_at_ms,
            kind: AiSessionEventKind::SessionCreated { metadata: metadata.clone() },
        };
        self.append_records(session_id, vec![AiSessionRecord::Event {
            version: AI_SESSION_RECORD_VERSION,
            event: created.clone(),
        }]).await?;
        session.events.push(created);
        self.sessions.insert(session_id.to_owned(), session.clone());
        Ok(session)
    }

    pub async fn append(
        &self,
        session_id: &str,
        operation_id: Option<&str>,
        kind: AiSessionEventKind,
    ) -> Result<AiSessionEvent, String> {
        // One actor serializes each live session. Allocate this sequence before
        // writing, then only expose it after the writer acknowledges the event.
        let mut event = {
            let session = self
                .sessions
                .get(session_id)
                .ok_or_else(|| "The AI session is not open".to_owned())?;
            AiSessionEvent {
                event_id: Uuid::new_v4().to_string(),
                sequence: session.events.len() as u64 + 1,
                operation_id: operation_id.map(str::to_owned).or_else(|| operation_id_for(&kind)),
                operation_sequence: None,
                occurred_at_ms: now_ms(),
                kind,
            }
        };
        if matches!(
            &event.kind,
            AiSessionEventKind::OperationTransition {
                transition: crate::agent::operation::OperationTransition {
                    state: crate::agent::operation::OperationState::Accepted,
                    ..
                }
            }
        ) {
            event.operation_sequence = Some(
                self.sessions.get(session_id).map(|session| session.operations.len() as u64 + 1).unwrap_or(1),
            );
        }
        self.append_records(
            session_id,
            vec![AiSessionRecord::Event {
                version: AI_SESSION_RECORD_VERSION,
                event: event.clone(),
            }],
        )
        .await?;
        let mut session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| "The AI session is not open".to_owned())?;
        apply_event(&mut session, session_id, event.clone())?;
        Ok(event)
    }

    /// Ask the selected model for a short human-facing session title.
    pub async fn generate_title(
        &self,
        model: &AiSessionModel,
        prompt: &str,
    ) -> Result<Option<String>, String> {
        let Some(config) = self.model_backend.as_ref() else {
            return Ok(None);
        };
        let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
        let started_at = std::time::Instant::now();
        tracing::debug!(
            model_id = %model.model_id,
            endpoint = %endpoint,
            prompt_bytes = prompt.len(),
            timeout_seconds = 20_u64,
            "starting AI session title request"
        );
        let request = ChatCompletionRequest {
            model: model.model_id.clone(),
            messages: vec![
                OpenAiChatMessage {
                    role: "system".to_owned(),
                    content: Some("Create a concise 3-6 word title for the user's request. Return only the title, with no quotes or punctuation.".to_string()),
                    tool_calls: None,
                    tool_call_id: None,
                },
                OpenAiChatMessage {
                    role: "user".to_owned(),
                    content: Some(prompt.to_owned()),
                    tool_calls: None,
                    tool_call_id: None,
                },
            ],
            stream: false,
            tools: None,
            // A title is metadata, not an agent reasoning task. Qwen/vLLM can
            // otherwise spend most of the short request budget in <think>.
            chat_template_kwargs: Some(serde_json::json!({ "enable_thinking": false })),
            stream_options: None,
        };
        let result = async {
            let response = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|error| {
                    tracing::error!(error = ?error, "could not create AI session title client");
                    format!("could not create title client: {error:?}")
                })?
                .post(endpoint)
                .bearer_auth(config.api_key())
                .json(&request)
                .send()
                .await
                .map_err(|error| {
                    tracing::error!(
                        error = ?error,
                        is_timeout = error.is_timeout(),
                        is_connect = error.is_connect(),
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        "AI session title request failed"
                    );
                    format!("title request failed: {error:?}")
                })?;
            let status = response.status();
            if !response.status().is_success() {
                let body = response.text().await.unwrap_or_default();
                let body_preview = body.chars().take(2_000).collect::<String>();
                tracing::error!(
                    %status,
                    elapsed_ms = started_at.elapsed().as_millis() as u64,
                    body_preview,
                    "AI session title request was rejected"
                );
                return Err(format!(
                    "title request returned HTTP {status}: {body_preview}"
                ));
            }
            let body = response.bytes().await.map_err(|error| {
                tracing::error!(error = ?error, "could not read AI session title response body");
                format!("could not read title response body: {error:?}")
            })?;
            let response =
                serde_json::from_slice::<TitleCompletionResponse>(&body).map_err(|error| {
                    let body_preview = String::from_utf8_lossy(&body)
                        .chars()
                        .take(2_000)
                        .collect::<String>();
                    tracing::error!(
                        error = ?error,
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        body_preview,
                        "AI session title response was invalid"
                    );
                    format!("invalid title response: {error:?}; body: {body_preview}")
                })?;
            tracing::debug!(
                elapsed_ms = started_at.elapsed().as_millis() as u64,
                choices = response.choices.len(),
                "AI session title request completed"
            );
            Ok(response
                .choices
                .into_iter()
                .find_map(|choice| normalize_title(&choice.message.content)))
        }
        .await;
        result
    }

    fn load_sessions(&self) -> anyhow::Result<()> {
        for entry in std::fs::read_dir(&self.sessions_dir).with_context(|| {
            format!(
                "could not read AI session storage: {}",
                self.sessions_dir.display()
            )
        })? {
            let entry = entry.context("could not read AI session storage entry")?;
            let path = entry.path();
            if !entry.file_type()?.is_file() || path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }
            let session_id = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .context("AI session filename is not valid UTF-8")?;
            validate_session_id(session_id).map_err(anyhow::Error::msg)?;
            let contents = std::fs::read_to_string(&path)
                .with_context(|| format!("could not read AI session: {}", path.display()))?;
            let session = replay_session(session_id, &contents).map_err(anyhow::Error::msg)?;
            self.sessions.insert(session_id.to_owned(), session);
        }
        Ok(())
    }

    async fn append_records(
        &self,
        session_id: &str,
        records: Vec<AiSessionRecord>,
    ) -> Result<(), String> {
        let path = self.session_path(session_id)?;
        let writer = self
            .writers
            .entry(session_id.to_owned())
            .or_insert_with(|| std::sync::Arc::new(SessionWriter::spawn(path)))
            .clone();
        writer.append(records).await.map_err(|error| {
            tracing::error!(session_id, error = %error, "durable AI session write failed");
            "The AI session could not be written to storage".to_owned()
        })
    }

    fn session_path(&self, session_id: &str) -> Result<PathBuf, String> {
        validate_session_id(session_id)?;
        Ok(self.sessions_dir.join(format!("{session_id}.jsonl")))
    }
}

fn matches_query(session: &AgentSessionLog, query: Option<&str>) -> bool {
    let Some(query) = query else {
        return true;
    };
    let query = query.to_lowercase();
    session.metadata.title.to_lowercase().contains(&query)
        || session
                .settled_messages()
            .iter()
            .any(|message| message.content.to_lowercase().contains(&query))
}

fn replay_session(session_id: &str, contents: &str) -> Result<AgentSessionLog, String> {
    let mut session = None;
    let lines = contents.lines().collect::<Vec<_>>();
    for (index, line) in lines.iter().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let record = match serde_json::from_str::<AiSessionRecord>(line) {
            Ok(record) => record,
            Err(_) if index + 1 == lines.len() && !contents.ends_with('\n') => {
                tracing::warn!(session_id, "ignored torn AI session log tail");
                break;
            }
            Err(_) => return Err("The AI session storage is corrupt".to_owned()),
        };
        let AiSessionRecord::Event { version, event } = record;
        if version != AI_SESSION_RECORD_VERSION {
            return Err("The AI session storage has an unsupported event version".to_owned());
        }
        match (&mut session, event) {
            (None, event) if matches!(&event.kind, AiSessionEventKind::SessionCreated { metadata } if metadata.id == session_id) => {
                let AiSessionEventKind::SessionCreated { metadata } = &event.kind else {
                    unreachable!("guard guarantees a session creation event");
                };
                session = Some(AgentSessionLog {
                    metadata: metadata.clone(),
                    operations: Vec::new(),
                    events: vec![event.clone()],
                });
            }
            (Some(session), event) => apply_event(session, session_id, event)?,
            _ => return Err("The AI session storage must begin with session_created".to_owned()),
        }
    }
    session.ok_or_else(|| "The AI session storage is empty".to_owned())
}

fn apply_event(
    session: &mut AgentSessionLog,
    session_id: &str,
    event: AiSessionEvent,
) -> Result<(), String> {
    if event.sequence != session.events.len() as u64 + 1 {
        return Err("The AI session event sequence is not contiguous".to_owned());
    }
    let event_for_projection = event.clone();
    match event.kind {
        AiSessionEventKind::SessionCreated { .. } => {
            return Err("The AI session storage has multiple creation events".to_owned());
        }
        AiSessionEventKind::SessionNamed { title } => {
            session.metadata.title = title;
        }
        AiSessionEventKind::ModelSelected { model } => {
            session.metadata.model = Some(model);
        }
        AiSessionEventKind::OperationTransition { transition } => {
            if let Some(operation) = session
                .operations
                .iter_mut()
                .find(|operation| operation.operation_id == transition.operation_id)
            {
                operation.apply(transition).map_err(str::to_owned)?;
            } else if matches!(transition.state, crate::agent::operation::OperationState::Accepted) {
                session.operations.push(crate::agent::operation::OperationSnapshot {
                    operation_id: transition.operation_id,
                    request_id: transition.request_id,
                    operation_sequence: event.operation_sequence.unwrap_or(session.operations.len() as u64 + 1),
                    status: crate::agent::operation::OperationStatus::for_state(
                        &crate::agent::operation::OperationState::Accepted,
                    ),
                    state: crate::agent::operation::OperationState::Accepted,
                    accepted_at_ms: transition.occurred_at_ms,
                    updated_at_ms: transition.occurred_at_ms,
                });
            } else {
                return Err("The AI session storage has an operation without acceptance".to_owned());
            }
        }
        AiSessionEventKind::Message { .. } | AiSessionEventKind::Reasoning { .. } | AiSessionEventKind::UserMessageQueued { .. } | AiSessionEventKind::UserMessageCancelled { .. } | AiSessionEventKind::ModelIntent { .. } | AiSessionEventKind::ToolCall { .. } | AiSessionEventKind::ToolIntent { .. }
        | AiSessionEventKind::ToolResult { .. } | AiSessionEventKind::Failure { .. } => {}
    }
    session.events.push(event_for_projection);
    if session.metadata.id != session_id {
        return Err("The AI session storage belongs to another session".to_owned());
    }
    Ok(())
}

fn operation_id_for(kind: &AiSessionEventKind) -> Option<String> {
    match kind {
        AiSessionEventKind::OperationTransition { transition } => Some(transition.operation_id.clone()),
        _ => None,
    }
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("The AI session id is invalid".to_owned());
    }
    Ok(())
}

#[derive(Deserialize)]
struct TitleCompletionResponse {
    choices: Vec<TitleCompletionChoice>,
}

#[derive(Deserialize)]
struct TitleCompletionChoice {
    message: TitleCompletionMessage,
}

#[derive(Deserialize)]
struct TitleCompletionMessage {
    content: String,
}

fn normalize_title(content: &str) -> Option<String> {
    let normalized = content
        .trim()
        .trim_matches(['"', '\''])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        return None;
    }
    let mut title = normalized.chars().take(60).collect::<String>();
    if normalized.chars().count() > 60 {
        title.push('…');
    }
    Some(title)
}


#[cfg(test)]
mod tests {
    use super::{replay_session, DEFAULT_SESSION_TITLE};
    use crate::{
        agent::operation::{OperationState, OperationStatus, OperationTransition},
        models::{AI_SESSION_RECORD_VERSION, AiSessionEvent, AiSessionEventKind, AiSessionMetadata, AiSessionRecord, ChatRole},
    };

    #[test]
    fn replays_one_ordered_event_format() {
        let records = [
            AiSessionRecord::Event { version: AI_SESSION_RECORD_VERSION, event: AiSessionEvent {
                event_id: "created".into(), sequence: 1, operation_id: None, operation_sequence: None,
                occurred_at_ms: 1, kind: AiSessionEventKind::SessionCreated { metadata: AiSessionMetadata {
                    id: "session-1".into(), title: DEFAULT_SESSION_TITLE.into(), created_at_ms: 1, model: None,
                } },
            } },
            AiSessionRecord::Event { version: AI_SESSION_RECORD_VERSION, event: AiSessionEvent {
                event_id: "user".into(), sequence: 2, operation_id: Some("operation-1".into()), operation_sequence: Some(1),
                occurred_at_ms: 2, kind: AiSessionEventKind::Message { message_id: None, role: ChatRole::User, content: "hello".into(), thinking: None, usage: None },
            } },
        ];
        let contents = records.iter().map(serde_json::to_string).collect::<Result<Vec<_>, _>>().unwrap().join("\n") + "\n";
        let session = replay_session("session-1", &contents).unwrap();
        assert_eq!(session.events.iter().map(|event| event.sequence).collect::<Vec<_>>(), [1, 2]);
        assert_eq!(session.settled_messages()[0].content, "hello");
        assert_eq!(session.events[1].operation_id.as_deref(), Some("operation-1"));
        assert_eq!(session.events[1].event_id, "user");
    }

    #[test]
    fn accepted_operation_replays_as_pending_work() {
        let metadata = AiSessionMetadata { id: "session-1".into(), title: DEFAULT_SESSION_TITLE.into(), created_at_ms: 1, model: None };
        let records = [
            AiSessionRecord::Event { version: AI_SESSION_RECORD_VERSION, event: AiSessionEvent {
                event_id: "created".into(), sequence: 1, operation_id: None, operation_sequence: None,
                occurred_at_ms: 1, kind: AiSessionEventKind::SessionCreated { metadata },
            } },
            AiSessionRecord::Event { version: AI_SESSION_RECORD_VERSION, event: AiSessionEvent {
                event_id: "accepted".into(), sequence: 2, operation_id: Some("operation-1".into()), operation_sequence: Some(1),
                occurred_at_ms: 2, kind: AiSessionEventKind::OperationTransition { transition: OperationTransition {
                    operation_id: "operation-1".into(), request_id: "request-1".into(), state: OperationState::Accepted, occurred_at_ms: 2,
                } },
            } },
        ];
        let contents = records.iter().map(serde_json::to_string).collect::<Result<Vec<_>, _>>().unwrap().join("\n") + "\n";
        let session = replay_session("session-1", &contents).unwrap();
        assert_eq!(session.operations[0].status, OperationStatus::Pending);
    }
}
