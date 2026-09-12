use std::{
    process::Stdio,
    sync::{Arc, atomic::AtomicI64},
    time::Duration,
};

use dashmap::DashMap;

use tokio::{
    process::{ChildStdin, ChildStdout, Command},
    sync::{Mutex, oneshot},
};

use crate::models::{FileId, LanguageId, WorkspaceId};

use std::{path::Path, sync::atomic::Ordering};

use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::ChildStderr,
};
use tracing::{debug, warn};

use crate::{
    models::{JsonRpcError, JsonRpcMessage, LspFramedReader, RawLspDiagnostic},
    state::AppState,
};

pub struct LspServerActor {
    workspace_id: WorkspaceId,
    language_id: LanguageId,
    stdin: Mutex<ChildStdin>,
    child: Mutex<tokio::process::Child>,
    pending: DashMap<i64, oneshot::Sender<Result<serde_json::Value, JsonRpcError>>>,
    next_id: AtomicI64,
    app_state: Arc<AppState>,
}

impl std::fmt::Debug for LspServerActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LspServerActor")
            .field("workspace_id", &self.workspace_id)
            .field("language_id", &self.language_id)
            .field("pending", &self.pending.len())
            .finish()
    }
}

impl LspServerActor {
    pub async fn spawn(
        app_state: Arc<AppState>,
        workspace_root: &Path,
        workspace_id: WorkspaceId,
        language: LanguageId,
    ) -> anyhow::Result<Arc<Self>> {
        debug!("Spawning LSP {:?}", language.server_binary_path());
        let mut child = Command::new(language.server_binary_path())
            .args(language.server_args())
            .current_dir(workspace_root)
            .kill_on_drop(true) // don't orphan the process if we crash/restart
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");

        let actor = Arc::new(Self {
            workspace_id,
            language_id: language,
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending: DashMap::new(),
            next_id: AtomicI64::new(1),
            app_state,
        });

        Self::spawn_read_loop(actor.clone(), stdout);
        Self::spawn_stderr_logger(actor.clone(), stderr);

        actor.initialize(workspace_root).await?;
        Ok(actor)
    }

    pub fn language_id(&self) -> LanguageId {
        self.language_id
    }

    async fn initialize(&self, root: &Path) -> anyhow::Result<()> {
        self.request(
            "initialize",
            serde_json::json!({
                    "processId": std::process::id(),
                    "rootUri": format!("file://{}", root.display()),
                    "capabilities": {
                        "general": {
                            "positionEncodings": ["utf-8", "utf-16"]
                        },
                        "workspace": {
                            "workspaceEdit": {
                                // versioned per-document edits (TextDocumentEdit[]) rather
                                // than the flat uri->TextEdit[] map — worth declaring now
                                // even though nothing uses it yet, since rename/code actions
                                // will want it and it's awkward to add capabilities later
                                // without re-negotiating.
                                "documentChanges": true
                            },
                            "symbol": {
                                // for workspace/symbol — "go to symbol in workspace", a
                                // command-palette staple. No special item-kind support
                                // declared yet; add "tagSupport"/"resolveSupport" only once
                                // you're actually consuming those fields.
                                "dynamicRegistration": false
                            }
                        },
                        "textDocument": {
                            "synchronization": {
                                "dynamicRegistration": false,
                                "willSave": false,
                                "willSaveWaitUntil": false,
                                "didSave": true
                            },
                            "publishDiagnostics": {
                                "relatedInformation": true,
                                "tagSupport": { "valueSet": [1, 2] }, // Unnecessary, Deprecated — matches DiagnosticTag
                                "versionSupport": false
                            },
                            "hover": {
                                // matches what hover.ts actually renders — plaintext/markdown
                                // strings via formatContents(), nothing richer.
                                "dynamicRegistration": false,
                                "contentFormat": ["plaintext", "markdown"]
                            },
                            "completion": {
                                // matches what autocomplete.ts actually consumes: label, kind,
                                // detail, textEdit.newText, documentation, sortText, filterText.
                                "dynamicRegistration": false,
                                "completionItem": {
                                    "snippetSupport": false, // set true only once you insert $1/$2 placeholders, not just newText verbatim
                                    "documentationFormat": ["plaintext", "markdown"],
                                    "deprecatedSupport": true // maps directly to CompletionItemTag.Deprecated, cheap to declare
                                },
                                "contextSupport": true // you already send `context: { triggerKind, triggerCharacter }`
                            },
                            "definition": {
                                // textDocument/definition — "go to definition"
                                "dynamicRegistration": false,
                                "linkSupport": false // true only once you handle LocationLink (with originSelectionRange) vs plain Location
                            },
                            "references": {
                                // textDocument/references — "find all references"
                                "dynamicRegistration": false
                            },
                            "documentSymbol": {
                                // textDocument/documentSymbol — "go to symbol in file"
                                "dynamicRegistration": false,
                                "hierarchicalDocumentSymbolSupport": true // nested DocumentSymbol[] tree instead of flat SymbolInformation[] — worth it for outline views
                            },
                            "codeAction": {
                                // textDocument/codeAction — quick fixes, refactors
                                "dynamicRegistration": false,
                                "codeActionLiteralSupport": {
                                    "codeActionKind": {
                                        "valueSet": ["quickfix", "refactor", "source", "source.organizeImports"]
                                    }
                                }
                            },
                            "formatting": {
                                // textDocument/formatting — "format document"
                                "dynamicRegistration": false
                            },
                            "rename": {
                                // textDocument/rename — "rename symbol"
                                "dynamicRegistration": false,
                                "prepareSupport": false // true only once you call textDocument/prepareRename first to validate/get a range
                            }
                        }
                    }, // expand as you wire up specific LSP features
                }),
        )
        .await?;
        self.notify("initialized", serde_json::json!({})).await

        // TODO(AI): We also need to actually get the return value back from the
        // LSP server so we respect what it outputs. This will need to be saved.
    }

    pub async fn request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let id = self.next_id.fetch_add(1, Ordering::AcqRel);
        let (tx, rx) = oneshot::channel();
        self.pending.insert(id, tx);

        let frame =
            serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(e) = self.write_frame(&frame).await {
            self.pending.remove(&id);
            return Err(e);
        }

        let language = self.language_id();
        match tokio::time::timeout(Duration::from_secs(10), rx).await {
            Ok(Ok(Ok(result))) => {
                debug!(
                    "LSP {:?} Response {:?}",
                    language.server_binary_path(),
                    result
                );
                Ok(result)
            }
            Ok(Ok(Err(rpc_err))) => {
                warn!(
                    "LSP {:?} Response {:?}",
                    language.server_binary_path(),
                    rpc_err
                );
                Err(rpc_err.into())
            }
            Ok(Err(_)) => anyhow::bail!("lsp server dropped request '{method}' without responding"),
            Err(_) => {
                self.pending.remove(&id);
                anyhow::bail!("lsp request '{method}' timed out")
            }
        }
    }

    pub async fn notify(&self, method: &str, params: serde_json::Value) -> anyhow::Result<()> {
        self.write_frame(
            &serde_json::json!({ "jsonrpc": "2.0", "method": method, "params": params }),
        )
        .await
    }

    async fn write_frame(&self, frame: &serde_json::Value) -> anyhow::Result<()> {
        let body = serde_json::to_vec(frame)?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(header.as_bytes()).await?;
        stdin.write_all(&body).await?;
        stdin.flush().await?;
        Ok(())
    }

    fn spawn_read_loop(actor: Arc<Self>, stdout: ChildStdout) {
        tokio::spawn(async move {
            let mut reader = LspFramedReader::new(stdout);
            while let Some(msg) = reader.next_message().await {
                match msg {
                    JsonRpcMessage::Response { id, result } => {
                        if let Some((_, tx)) = actor.pending.remove(&id) {
                            let _ = tx.send(result);
                        }
                    }
                    JsonRpcMessage::Notification { method, params } => {
                        actor.handle_notification(&method, params).await;
                    }
                    JsonRpcMessage::Request { id, method } => {
                        // server->client requests (workspace/configuration, etc.)
                        // aren't implemented yet — answer so the server doesn't hang.
                        debug!("unhandled server->client LSP request: {method}");
                        let _ = actor
                            .write_frame(&serde_json::json!({
                                "jsonrpc": "2.0", "id": id,
                                "error": { "code": -32601, "message": "not implemented" }
                            }))
                            .await;
                    }
                }
            }

            warn!(
                "LSP server for {:?} exited (stdout closed)",
                actor.language_id
            );
            if let Ok(status) = actor.child.lock().await.wait().await {
                debug!("LSP {:?} exit status: {status:?}", actor.language_id);
            }
            // TODO: There might be a cleaner way to handle this.
            actor
                .app_state
                .lsp_servers
                .remove(&(actor.workspace_id.clone(), actor.language_id));

            let pending_ids: Vec<i64> = actor.pending.iter().map(|e| *e.key()).collect();
            for id in pending_ids {
                if let Some((_, tx)) = actor.pending.remove(&id) {
                    let _ = tx.send(Err(JsonRpcError {
                        code: -1,
                        message: "lsp process exited".into(),
                    }));
                }
            }
        });
    }

    fn spawn_stderr_logger(actor: Arc<Self>, stderr: ChildStderr) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => debug!("[lsp:{:?}] {}", actor.language_id, line.trim_end()),
                }
            }
        });
    }

    async fn handle_notification(&self, method: &str, params: serde_json::Value) {
        if method != "textDocument/publishDiagnostics" {
            return; // logMessage, progress, etc. — not handled yet
        }
        let Some(uri) = params.get("uri").and_then(|v| v.as_str()) else {
            return;
        };
        let Some(file_id) = self.uri_to_file_id(uri).await else {
            debug!("diagnostics for untracked uri: {uri}");
            return;
        };

        let raw: Vec<RawLspDiagnostic> =
            serde_json::from_value(params.get("diagnostics").cloned().unwrap_or_default())
                .unwrap_or_default();
        let diagnostics = raw.into_iter().map(Into::into).collect();

        // clone the Arc out and drop the DashMap guard *before* awaiting —
        // holding a shard lock across an await is a deadlock waiting to happen.
        let doc = self
            .app_state
            .open_files
            .get(&(self.workspace_id.clone(), file_id))
            .map(|e| e.value().clone());
        if let Some(doc) = doc {
            doc.set_diagnostics(diagnostics).await;
        }
    }

    async fn uri_to_file_id(&self, uri: &str) -> Option<FileId> {
        let path = uri.strip_prefix("file://")?;
        let candidates: Vec<_> = self
            .app_state
            .open_files
            .iter()
            .filter(|entry| entry.key().0 == self.workspace_id)
            .map(|entry| (entry.key().1.clone(), entry.value().clone()))
            .collect();
        for (file_id, document) in candidates {
            if document.path_matches(path).await {
                return Some(file_id);
            }
        }
        None
    }
}
