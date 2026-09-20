use std::path::PathBuf;

use anyhow::Context;
use dashmap::DashMap;
use serde::Deserialize;

use crate::{
    agent::session::writer::SessionWriter,
    config::OpenAiCompatibleConfig,
    models::{
        AI_SESSION_RECORD_VERSION, AiSession, AiSessionFailure, AiSessionMetadata, AiSessionModel,
        AiSessionRecord, AiSessionSummary, ChatCompletionRequest, ChatMessage, OpenAiChatMessage,
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
    sessions: DashMap<String, AiSession>,
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
                message_count: entry.messages.len(),
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

    pub fn get(&self, session_id: &str) -> Option<AiSession> {
        self.sessions.get(session_id).map(|session| session.clone())
    }

    pub async fn open_or_create(&self, session_id: &str) -> Result<AiSession, String> {
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
        let session = AiSession {
            metadata: metadata.clone(),
            messages: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            failures: Vec::new(),
        };
        self.append_records(
            session_id,
            vec![AiSessionRecord::SessionCreated {
                version: AI_SESSION_RECORD_VERSION,
                metadata,
            }],
        )
        .await?;
        self.sessions.insert(session_id.to_owned(), session.clone());
        Ok(session)
    }

    pub async fn append(&self, session_id: &str, record: AiSessionRecord) -> Result<(), String> {
        self.append_records(session_id, vec![record.clone()])
            .await?;
        let mut session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| "The AI session is not open".to_owned())?;
        apply_record(&mut session, session_id, record)
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

fn matches_query(session: &AiSession, query: Option<&str>) -> bool {
    let Some(query) = query else {
        return true;
    };
    let query = query.to_lowercase();
    session.metadata.title.to_lowercase().contains(&query)
        || session
            .messages
            .iter()
            .any(|message| message.content.to_lowercase().contains(&query))
}

fn replay_session(session_id: &str, contents: &str) -> Result<AiSession, String> {
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
        match (&mut session, record) {
            (None, AiSessionRecord::SessionCreated { version, metadata })
                if version == AI_SESSION_RECORD_VERSION && metadata.id == session_id =>
            {
                session = Some(AiSession {
                    metadata,
                    messages: Vec::new(),
                    tool_calls: Vec::new(),
                    tool_results: Vec::new(),
                    failures: Vec::new(),
                });
            }
            (Some(session), record) => apply_record(session, session_id, record)?,
            _ => return Err("The AI session storage has an invalid record order".to_owned()),
        }
    }
    session.ok_or_else(|| "The AI session storage is empty".to_owned())
}

fn apply_record(
    session: &mut AiSession,
    session_id: &str,
    record: AiSessionRecord,
) -> Result<(), String> {
    match record {
        AiSessionRecord::SessionNamed { version, title, .. }
            if version == AI_SESSION_RECORD_VERSION =>
        {
            session.metadata.title = title;
        }
        AiSessionRecord::ModelSelected { version, model, .. }
            if version == AI_SESSION_RECORD_VERSION =>
        {
            session.metadata.model = Some(model);
        }
        AiSessionRecord::Message {
            version,
            role,
            content,
            thinking,
            usage,
            created_at_ms,
            ..
        } if version == AI_SESSION_RECORD_VERSION => session.messages.push(ChatMessage {
            role,
            content,
            thinking,
            usage,
            created_at_ms,
        }),
        AiSessionRecord::ToolCall {
            version,
            tool_call_id,
            name,
            arguments,
            created_at_ms,
        } if version == AI_SESSION_RECORD_VERSION => {
            session.tool_calls.push(crate::models::AiSessionToolCall {
                tool_call_id,
                name,
                arguments,
                created_at_ms,
            })
        }
        AiSessionRecord::ToolResult {
            version,
            tool_call_id,
            content,
            is_error,
            created_at_ms,
        } if version == AI_SESSION_RECORD_VERSION => {
            session
                .tool_results
                .push(crate::models::AiSessionToolResult {
                    tool_call_id,
                    content,
                    is_error,
                    created_at_ms,
                })
        }
        AiSessionRecord::Failure {
            version,
            code,
            message,
            detail,
            created_at_ms,
        } if version == AI_SESSION_RECORD_VERSION => session.failures.push(AiSessionFailure {
            code,
            message,
            detail,
            created_at_ms,
        }),
        AiSessionRecord::SessionCreated { .. } => {
            return Err("The AI session storage has multiple creation records".to_owned());
        }
        _ => return Err("The AI session storage has an unsupported record".to_owned()),
    }
    if session.metadata.id != session_id {
        return Err("The AI session storage belongs to another session".to_owned());
    }
    Ok(())
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
    use super::{AiSessionService, DEFAULT_SESSION_TITLE, replay_session};
    use crate::{
        agent::error::AgentFailureCode,
        models::{
            AI_SESSION_RECORD_VERSION, AiSessionMetadata, AiSessionRecord, AiTokenUsage, ChatRole,
        },
    };

    #[test]
    fn replays_settled_messages_and_ignores_a_torn_final_line() {
        let records = [
            AiSessionRecord::SessionCreated {
                version: AI_SESSION_RECORD_VERSION,
                metadata: AiSessionMetadata {
                    id: "conversation-1".into(),
                    title: DEFAULT_SESSION_TITLE.into(),
                    created_at_ms: 1,
                    model: None,
                },
            },
            AiSessionRecord::Message {
                version: AI_SESSION_RECORD_VERSION,
                role: ChatRole::User,
                content: "Fix the widget".into(),
                thinking: None,
                usage: None,
                created_at_ms: 2,
            },
            AiSessionRecord::Message {
                version: AI_SESSION_RECORD_VERSION,
                role: ChatRole::Assistant,
                content: "Done".into(),
                thinking: Some("I inspected the widget state first.".into()),
                usage: Some(AiTokenUsage {
                    prompt_tokens: 24,
                    completion_tokens: 12,
                    total_tokens: 36,
                    cached_tokens: Some(8),
                    reasoning_tokens: Some(4),
                }),
                created_at_ms: 3,
            },
            AiSessionRecord::ToolCall {
                version: AI_SESSION_RECORD_VERSION,
                tool_call_id: "call-1".into(),
                name: "read".into(),
                arguments: serde_json::json!({ "path": "src/widget.rs" }),
                created_at_ms: 4,
            },
            AiSessionRecord::ToolResult {
                version: AI_SESSION_RECORD_VERSION,
                tool_call_id: "call-1".into(),
                content: "{\"content\":\"widget\"}".into(),
                is_error: false,
                created_at_ms: 5,
            },
            AiSessionRecord::Failure {
                version: AI_SESSION_RECORD_VERSION,
                code: AgentFailureCode::ModelStreamFailed,
                message: "The next response stream was interrupted".into(),
                detail: Some("connection reset by peer".into()),
                created_at_ms: 6,
            },
        ];
        let mut contents = records
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n");
        contents.push_str("\n{\"type\":");
        let session = replay_session("conversation-1", &contents).unwrap();
        assert_eq!(session.messages.len(), 2);
        assert_eq!(
            session.messages[1].thinking.as_deref(),
            Some("I inspected the widget state first.")
        );
        assert_eq!(session.messages[1].usage.as_ref().unwrap().total_tokens, 36);
        assert_eq!(session.messages[1].created_at_ms, 3);
        assert_eq!(session.failures.len(), 1);
        assert_eq!(session.tool_calls.len(), 1);
        assert_eq!(session.tool_calls[0].tool_call_id, "call-1");
        assert_eq!(session.tool_results.len(), 1);
    }

    #[test]
    fn startup_index_supports_title_and_content_search() {
        let directory = std::env::temp_dir().join(format!(
            "forge-ai-session-service-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let records = [
            AiSessionRecord::SessionCreated {
                version: AI_SESSION_RECORD_VERSION,
                metadata: AiSessionMetadata {
                    id: "conversation-1".into(),
                    title: "New conversation".into(),
                    created_at_ms: 1,
                    model: None,
                },
            },
            AiSessionRecord::SessionNamed {
                version: AI_SESSION_RECORD_VERSION,
                title: "Repair widget".into(),
                updated_at_ms: 2,
            },
            AiSessionRecord::Message {
                version: AI_SESSION_RECORD_VERSION,
                role: ChatRole::User,
                content: "The zebra renderer is broken".into(),
                thinking: None,
                usage: None,
                created_at_ms: 3,
            },
        ];
        let contents = records
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n");
        std::fs::write(
            directory.join("conversation-1.jsonl"),
            format!("{contents}\n"),
        )
        .unwrap();

        let service = AiSessionService::new(directory.clone(), None).unwrap();
        assert_eq!(service.list(Some("repair")).len(), 1);
        assert_eq!(service.list(Some("ZEBRA")).len(), 1);
        assert_eq!(service.get("conversation-1").unwrap().messages.len(), 1);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
