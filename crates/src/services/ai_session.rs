use std::path::{Path, PathBuf};

use anyhow::Context;
use dashmap::DashMap;
use serde::Deserialize;
use tokio::{fs, io::AsyncWriteExt};

use crate::{
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
        let path = self.session_path(session_id)?;
        let metadata = AiSessionMetadata {
            id: session_id.to_owned(),
            title: DEFAULT_SESSION_TITLE.to_owned(),
            created_at_ms: now_ms(),
            model: None,
        };
        let session = AiSession {
            metadata: metadata.clone(),
            messages: Vec::new(),
            failures: Vec::new(),
        };
        self.append_to_path(
            &path,
            &AiSessionRecord::SessionCreated {
                version: AI_SESSION_RECORD_VERSION,
                metadata,
            },
        )
        .await?;
        self.sessions.insert(session_id.to_owned(), session.clone());
        Ok(session)
    }

    pub async fn append(&self, session_id: &str, record: AiSessionRecord) -> Result<(), String> {
        let path = self.session_path(session_id)?;
        self.append_to_path(&path, &record).await?;
        let mut session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| "The AI session is not open".to_owned())?;
        apply_record(&mut session, session_id, record)
    }

    /// Ask the selected model for a short human-facing session title.
    pub async fn generate_title(&self, model: &AiSessionModel, prompt: &str) -> Option<String> {
        let config = self.model_backend.as_ref()?;
        let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
        let request = ChatCompletionRequest {
            model: model.model_id.clone(),
            messages: vec![
                OpenAiChatMessage {
                    role: "system",
                    content: "Create a concise 3-6 word title for the user's request. Return only the title, with no quotes or punctuation.".to_string(),
                },
                OpenAiChatMessage {
                    role: "user",
                    content: prompt.to_owned(),
                },
            ],
            stream: false,
        };
        let result = async {
            let response = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|_| ())?
                .post(endpoint)
                .bearer_auth(config.api_key())
                .json(&request)
                .send()
                .await
                .map_err(|_| ())?;
            if !response.status().is_success() {
                return Err(());
            }
            let response = response
                .json::<TitleCompletionResponse>()
                .await
                .map_err(|_| ())?;
            response
                .choices
                .into_iter()
                .find_map(|choice| normalize_title(&choice.message.content))
                .ok_or(())
        }
        .await;
        result.ok()
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

    async fn append_to_path(&self, path: &Path, record: &AiSessionRecord) -> Result<(), String> {
        let payload = serde_json::to_vec(record)
            .map_err(|_| "The AI session could not be serialized".to_owned())?;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await
            .map_err(|_| "The AI session could not be written to storage".to_owned())?;
        file.write_all(&payload)
            .await
            .map_err(|_| "The AI session could not be written to storage".to_owned())?;
        file.write_all(b"\n")
            .await
            .map_err(|_| "The AI session could not be written to storage".to_owned())?;
        file.sync_data()
            .await
            .map_err(|_| "The AI session could not be written to storage".to_owned())
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
            ..
        } if version == AI_SESSION_RECORD_VERSION => session.messages.push(ChatMessage {
            role,
            content,
            thinking,
        }),
        AiSessionRecord::Failure {
            version,
            message,
            created_at_ms,
        } if version == AI_SESSION_RECORD_VERSION => session.failures.push(AiSessionFailure {
            message,
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
    use crate::models::{AI_SESSION_RECORD_VERSION, AiSessionMetadata, AiSessionRecord, ChatRole};

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
                created_at_ms: 2,
            },
            AiSessionRecord::Message {
                version: AI_SESSION_RECORD_VERSION,
                role: ChatRole::Assistant,
                content: "Done".into(),
                thinking: Some("I inspected the widget state first.".into()),
                created_at_ms: 3,
            },
            AiSessionRecord::Failure {
                version: AI_SESSION_RECORD_VERSION,
                message: "The next response stream was interrupted".into(),
                created_at_ms: 4,
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
        assert_eq!(session.failures.len(), 1);
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
