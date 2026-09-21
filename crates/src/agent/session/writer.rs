use std::path::PathBuf;

use tokio::{
    fs::OpenOptions,
    io::AsyncWriteExt,
    sync::{mpsc, oneshot},
};

use crate::models::AiSessionRecord;

/// The sole owner of append writes for one durable session file.
///
/// Callers submit complete logical records and wait for a durability receipt.
/// The task serializes each batch, writes every record with its newline as one
/// buffer, syncs it, and only then acknowledges the caller.
#[derive(Clone, Debug)]
pub struct SessionWriter {
    commands: mpsc::Sender<SessionWriteCommand>,
}

#[derive(Debug)]
enum SessionWriteCommand {
    Append {
        records: Vec<AiSessionRecord>,
        result: oneshot::Sender<Result<(), SessionWriteError>>,
    },
}

#[derive(Debug)]
pub struct SessionWriteError {
    operation: &'static str,
    detail: String,
}

impl std::fmt::Display for SessionWriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "session {} failed: {}",
            self.operation, self.detail
        )
    }
}

impl std::error::Error for SessionWriteError {}

impl SessionWriter {
    pub fn spawn(path: PathBuf) -> Self {
        let (commands, mut receiver) = mpsc::channel(32);
        tokio::spawn(async move {
            let mut file = None;
            while let Some(command) = receiver.recv().await {
                match command {
                    SessionWriteCommand::Append { records, result } => {
                        let outcome = append_records(&path, &mut file, records).await;
                        let _ = result.send(outcome);
                    }
                }
            }
        });
        Self { commands }
    }

    pub async fn append(&self, records: Vec<AiSessionRecord>) -> Result<(), SessionWriteError> {
        let (result, receiver) = oneshot::channel();
        self.commands
            .send(SessionWriteCommand::Append { records, result })
            .await
            .map_err(|_| SessionWriteError {
                operation: "dispatch",
                detail: "the session writer stopped unexpectedly".to_owned(),
            })?;
        receiver.await.map_err(|_| SessionWriteError {
            operation: "receive acknowledgement",
            detail: "the session writer stopped unexpectedly".to_owned(),
        })?
    }
}

async fn append_records(
    path: &PathBuf,
    file: &mut Option<tokio::fs::File>,
    records: Vec<AiSessionRecord>,
) -> Result<(), SessionWriteError> {
    if records.is_empty() {
        return Ok(());
    }
    let mut payload = Vec::new();
    for record in records {
        serde_json::to_writer(&mut payload, &record).map_err(|error| SessionWriteError {
            operation: "serialize",
            detail: error.to_string(),
        })?;
        payload.push(b'\n');
    }
    if file.is_none() {
        *file = Some(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .await
                .map_err(|error| SessionWriteError {
                    operation: "open",
                    detail: format!("{}: {error}", path.display()),
                })?,
        );
    }
    let file = file.as_mut().expect("file is initialized above");
    file.write_all(&payload)
        .await
        .map_err(|error| SessionWriteError {
            operation: "write",
            detail: format!("{}: {error}", path.display()),
        })?;
    file.sync_data().await.map_err(|error| SessionWriteError {
        operation: "sync",
        detail: format!("{}: {error}", path.display()),
    })
}

#[cfg(test)]
mod tests {
    use super::SessionWriter;
    use crate::models::{AI_SESSION_RECORD_VERSION, AiSessionEvent, AiSessionEventKind, AiSessionRecord, ChatRole};

    #[tokio::test]
    async fn serializes_whole_records_in_submission_order() {
        let path = std::env::temp_dir().join(format!(
            "forge-session-writer-test-{}.jsonl",
            uuid::Uuid::new_v4()
        ));
        let writer = SessionWriter::spawn(path.clone());
        writer
            .append(vec![AiSessionRecord::Event { version: AI_SESSION_RECORD_VERSION, event: AiSessionEvent {
                event_id: "first".into(), sequence: 1, operation_id: None, operation_sequence: None,
                occurred_at_ms: 1, kind: AiSessionEventKind::Message {
                message_id: None,
                role: ChatRole::User,
                content: "first".into(),
                thinking: None,
                usage: None,
            } } }])
            .await
            .unwrap();
        writer
            .append(vec![AiSessionRecord::Event { version: AI_SESSION_RECORD_VERSION, event: AiSessionEvent {
                event_id: "second".into(), sequence: 2, operation_id: None, operation_sequence: None,
                occurred_at_ms: 2, kind: AiSessionEventKind::Message {
                message_id: None,
                role: ChatRole::Assistant,
                content: "second".into(),
                thinking: None,
                usage: None,
            } } }])
            .await
            .unwrap();
        let contents = tokio::fs::read_to_string(&path).await.unwrap();
        assert_eq!(contents.lines().count(), 2);
        tokio::fs::remove_file(path).await.unwrap();
    }
}
