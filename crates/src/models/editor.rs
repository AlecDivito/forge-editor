use super::LspDiagnostic;
use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};

pub type FileId = String;
pub type ClientId = String;
pub type WorkspaceId = String;
pub type TerminalId = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum LanguageId {
    Rust,
    TypeScript,
    JavaScript,
    Python,
    Go,
    Json,
    Yaml,
    Shell,
    Dockerfile,
}

impl LanguageId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::TypeScript => "typescript",
            Self::JavaScript => "javascript",
            Self::Python => "python",
            Self::Go => "go",
            Self::Json => "json",
            Self::Yaml => "yaml",
            Self::Shell => "shellscript",
            Self::Dockerfile => "dockerfile",
        }
    }

    pub fn server_binary_path(&self) -> &'static str {
        match self {
            Self::Rust => "rust-analyzer",
            Self::TypeScript | Self::JavaScript => "typescript-language-server",
            Self::Python => "pyright-langserver",
            Self::Go => "gopls",
            // no LSP wired up for these yet — from_path will still return
            // Some(..) for them, so callers that need a server must check
            // has_lsp_support() before spawning.
            Self::Json | Self::Yaml | Self::Shell | Self::Dockerfile => "",
        }
    }

    /// Command-line arguments required to run the language server over stdio.
    pub fn server_args(&self) -> &'static [&'static str] {
        match self {
            // gopls serves LSP over stdin/stdout by default and rejects
            // the --stdio flag used by several Node-based language servers.
            Self::Go => &["serve"],
            Self::Rust
            | Self::TypeScript
            | Self::JavaScript
            | Self::Python
            | Self::Json
            | Self::Yaml
            | Self::Shell
            | Self::Dockerfile => &["--stdio"],
        }
    }

    /// Whether this language currently has an LSP server configured.
    pub fn has_lsp_support(&self) -> bool {
        !self.server_binary_path().is_empty()
    }

    /// Fast path: identify by extension alone, no I/O. Covers the vast
    /// majority of files and is what you want on any hot path.
    fn from_extension(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()? {
            "rs" => Some(Self::Rust),
            "ts" | "tsx" => Some(Self::TypeScript),
            "js" | "jsx" | "mjs" | "cjs" => Some(Self::JavaScript),
            "py" | "pyi" => Some(Self::Python),
            "go" => Some(Self::Go),
            "json" => Some(Self::Json),
            "yaml" | "yml" => Some(Self::Yaml),
            "sh" | "bash" => Some(Self::Shell),
            _ => None,
        }
    }

    /// Extensionless files, identified by name or (as a last resort) by
    /// reading the shebang line. This is the part that needs to be async.
    fn from_filename(path: &Path) -> Option<Self> {
        match path.file_name()?.to_str()? {
            "Dockerfile" | "Containerfile" => Some(Self::Dockerfile),
            _ => None,
        }
    }

    async fn from_shebang(path: &Path) -> Option<Self> {
        let file = tokio::fs::File::open(path).await.ok()?;
        let mut reader = BufReader::new(file);
        let mut first_line = String::new();
        // cap the read — a binary file with no newline in its first few KB
        // shouldn't make this hang reading the whole thing into memory.
        reader.read_line(&mut first_line).await.ok()?;

        if !first_line.starts_with("#!") {
            return None;
        }
        if first_line.contains("python") {
            Some(Self::Python)
        } else if first_line.contains("bash") || first_line.contains("/sh") {
            Some(Self::Shell)
        } else if first_line.contains("node") {
            Some(Self::JavaScript)
        } else {
            None
        }
    }

    /// Resolve a file's language for LSP routing. Cheapest checks first;
    /// only touches disk for extensionless files that need a shebang peek.
    pub async fn from_path(path: &Path) -> Option<Self> {
        if let Some(lang) = Self::from_extension(path) {
            return Some(lang);
        }
        if let Some(lang) = Self::from_filename(path) {
            return Some(lang);
        }
        Self::from_shebang(path).await
    }
}

#[derive(Deserialize, Serialize, JsonSchema, Clone)]
pub struct ClientParams {
    id: Option<String>,
}

impl ClientParams {
    pub fn get_client_id(&self) -> ClientId {
        self.id.clone().unwrap_or("default".into())
    }
}

#[derive(Clone)]
pub enum DocEvent {
    Update {
        update: Vec<u8>,
        origin: ClientId,
    },
    AwarenessUpdate {
        payload: Vec<u8>,
        origin: ClientId,
    },
    Diagnostics {
        diagnostics: Vec<LspDiagnostic>,
    },
    State {
        revision: u64,
        persisted_revision: u64,
        phase: PersistencePhase,
        error: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotFound,
    Deleted,
    ReadOnly,
    SaveFailed,
    RenameConflict,
    DirtyDeleteConflict,
    BadPath,
    Unsupported,
}

/// Persistence state carried on the wire. The `kind` discriminator remains
/// PascalCase for compatibility with the existing websocket protocol, while
/// enum values are stable snake_case strings.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersistencePhase {
    Clean,
    Pending,
    Saving,
    SaveError,
    Deleted,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FsEntryType {
    File,
    Directory,
    Symlink,
}

#[derive(JsonSchema, Serialize, Deserialize, Clone)]
#[serde(tag = "kind")]
pub enum ClientMessage {
    Hello,

    DocSubscribe {
        workspace_id: WorkspaceId,
        file_id: FileId,
    },
    DocUnsubscribe {
        workspace_id: WorkspaceId,
        file_id: FileId,
    },
    DocUpdate {
        workspace_id: WorkspaceId,
        file_id: FileId,
        update: Vec<u8>,
    },
    DocSyncStep1 {
        workspace_id: WorkspaceId,
        file_id: FileId,
        state_vector: Vec<u8>,
    },
    DocSyncStep2 {
        workspace_id: WorkspaceId,
        file_id: FileId,
        update: Vec<u8>,
    },
    DocSave {
        workspace_id: WorkspaceId,
        file_id: FileId,
        request_id: uuid::Uuid,
    },

    // presence - cursors, selections, "who's here"
    AwarenessUpdate {
        workspace_id: WorkspaceId,
        file_id: FileId,
        payload: Vec<u8>,
    },

    TerminalOpen {
        workspace_id: WorkspaceId,
        term_id: TerminalId,
        cols: u16,
        rows: u16,
    },
    TerminalInput {
        term_id: TerminalId,
        data: Vec<u8>,
    },
    TerminalResize {
        term_id: TerminalId,
        cols: u16,
        rows: u16,
    },
    TerminalClose {
        term_id: TerminalId,
    },

    LspRequest {
        workspace_id: WorkspaceId,
        file_id: FileId,
        request_id: uuid::Uuid,
        method: String,
        params: serde_json::Value,
    },
    LspNotification {
        workspace_id: WorkspaceId,
        file_id: FileId,
        method: String,
        params: serde_json::Value,
    },

    Ping,
}

impl std::fmt::Display for ClientMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClientMessage::Hello => write!(f, "Hello"),

            ClientMessage::DocSubscribe {
                workspace_id,
                file_id,
            } => write!(f, "DocSubscribe({workspace_id}, {file_id})"),

            ClientMessage::DocUnsubscribe {
                workspace_id,
                file_id,
            } => write!(f, "DocUnsubscribe({workspace_id}, {file_id})"),

            ClientMessage::DocUpdate {
                workspace_id,
                file_id,
                update,
            } => write!(
                f,
                "DocUpdate({workspace_id}, {file_id}, {} bytes)",
                update.len()
            ),

            ClientMessage::DocSyncStep1 {
                workspace_id,
                file_id,
                state_vector,
            } => write!(
                f,
                "DocSyncStep1({workspace_id}, {file_id}, {} bytes)",
                state_vector.len()
            ),

            ClientMessage::DocSyncStep2 {
                workspace_id,
                file_id,
                update,
            } => write!(
                f,
                "DocSyncStep2({workspace_id}, {file_id}, {} bytes)",
                update.len()
            ),

            ClientMessage::DocSave {
                workspace_id,
                file_id,
                request_id,
            } => write!(f, "DocSave({workspace_id}, {file_id}, {request_id})"),

            ClientMessage::AwarenessUpdate {
                workspace_id,
                file_id,
                payload,
            } => write!(
                f,
                "AwarenessUpdate({workspace_id}, {file_id}, {} bytes)",
                payload.len()
            ),

            ClientMessage::TerminalOpen {
                workspace_id,
                term_id,
                cols,
                rows,
            } => write!(f, "TerminalOpen({workspace_id}, {term_id}, {cols}x{rows})"),

            ClientMessage::TerminalInput { term_id, data } => {
                write!(f, "TerminalInput({term_id}, {} bytes)", data.len())
            }

            ClientMessage::TerminalResize {
                term_id,
                cols,
                rows,
            } => write!(f, "TerminalResize({term_id}, {cols}x{rows})"),

            ClientMessage::TerminalClose { term_id } => {
                write!(f, "TerminalClose({term_id})")
            }

            ClientMessage::LspRequest {
                workspace_id,
                file_id,
                request_id,
                method,
                params,
            } => write!(
                f,
                "LspRequest({workspace_id}, {file_id}, {request_id}, {method}, {params})"
            ),

            ClientMessage::LspNotification {
                workspace_id,
                file_id,
                method,
                params,
            } => write!(
                f,
                "LspNotification({workspace_id}, {file_id}, {method}, {params})"
            ),

            ClientMessage::Ping => write!(f, "Ping"),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind")]
pub enum ServerMessage {
    Hello {
        client_id: ClientId,
        environment_id: String,
        schema_version: u32,
    },
    DocSync {
        workspace_id: WorkspaceId,
        file_id: FileId,
        update: Vec<u8>,
    },
    DocSyncStep2 {
        workspace_id: WorkspaceId,
        file_id: FileId,
        update: Vec<u8>,
        state_vector: Vec<u8>,
        revision: u64,
        persisted_revision: u64,
    },
    DocState {
        workspace_id: WorkspaceId,
        file_id: FileId,
        revision: u64,
        persisted_revision: u64,
        phase: PersistencePhase,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    DocSaveResult {
        workspace_id: WorkspaceId,
        file_id: FileId,
        request_id: uuid::Uuid,
        saved_revision: u64,
        current_revision: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    FsRenamed {
        workspace_id: WorkspaceId,
        from: String,
        to: String,
        entry_type: FsEntryType,
    },
    FsDeleted {
        workspace_id: WorkspaceId,
        path: String,
        entry_type: FsEntryType,
    },
    DocUpdate {
        workspace_id: WorkspaceId,
        file_id: FileId,
        update: Vec<u8>,
        origin: ClientId,
    },

    AwarenessUpdate {
        workspace_id: WorkspaceId,
        file_id: FileId,
        client_id: ClientId,
        payload: Vec<u8>,
    },
    AwarenessSnapshot {
        workspace_id: WorkspaceId,
        file_id: FileId,
        payload: Vec<u8>,
    },

    TerminalOutput {
        term_id: TerminalId,
        data: Vec<u8>,
    },
    TerminalExit {
        term_id: TerminalId,
        code: i32,
    },

    LspResponse {
        request_id: uuid::Uuid,
        result: serde_json::Value,
    },
    LspError {
        request_id: uuid::Uuid,
        message: String,
    },
    Diagnostics {
        workspace_id: WorkspaceId,
        file_id: FileId,
        diagnostics: Vec<LspDiagnostic>,
    },

    Error {
        context: Option<String>,
        code: ErrorCode,
        message: String,
    },
    Pong,
}
/*
This was output by AI. I think it's a good idea to keep around in the code base
if we want to optimize this process in the future.
If you want to skip JSON overhead for the hot doc-update / terminal-byte paths, use a tiny binary framing instead: [u8 kind][u32 target_id][u32 len][payload]. JSON envelope is fine to start; switch to binary framing only if you profile a problem.
*/

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_client_messages_use_json_number_arrays() {
        let message = ClientMessage::DocSyncStep2 {
            workspace_id: "workspace".into(),
            file_id: "src/main.rs".into(),
            update: vec![0, 127, 255],
        };
        let json = serde_json::to_value(&message).expect("message serializes");
        assert_eq!(json["kind"], "DocSyncStep2");
        assert_eq!(json["update"], serde_json::json!([0, 127, 255]));
    }

    #[test]
    fn lifecycle_server_messages_round_trip() {
        let message = ServerMessage::DocState {
            workspace_id: "workspace".into(),
            file_id: "src/main.rs".into(),
            revision: 3,
            persisted_revision: 2,
            phase: PersistencePhase::Pending,
            error: None,
        };
        let json = serde_json::to_string(&message).expect("message serializes");
        assert!(json.contains(r#""phase":"pending""#));
        let decoded: ServerMessage = serde_json::from_str(&json).expect("message decodes");
        match decoded {
            ServerMessage::DocState {
                revision,
                persisted_revision,
                phase,
                ..
            } => {
                assert_eq!(revision, 3);
                assert_eq!(persisted_revision, 2);
                assert_eq!(phase, PersistencePhase::Pending);
            }
            _ => panic!("decoded wrong message kind"),
        }
    }

    #[test]
    fn filesystem_event_serialization_is_explicit() {
        let message = ServerMessage::FsRenamed {
            workspace_id: "workspace".into(),
            from: "old.rs".into(),
            to: "new.rs".into(),
            entry_type: FsEntryType::File,
        };
        let json = serde_json::to_value(message).expect("message serializes");
        assert_eq!(json["kind"], "FsRenamed");
        assert_eq!(json["entry_type"], "file");
    }
}
