use super::{
    AdapterCommand, AdapterTransport, ConfigurationList, CreateSession, DebugStrategy, OutputChunk,
    ResolvedConfiguration, SessionSnapshot, SessionState, StrategyRegistry, config, dap,
};
use dashmap::DashMap;
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
};
use std::{process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::{TcpListener, TcpStream},
    process::{Child, Command},
    sync::{Mutex, mpsc, oneshot},
};
use uuid::Uuid;

const MAX_OUTPUT_BYTES: usize = super::limits::MAX_OUTPUT_BYTES;

#[derive(Debug)]
struct Record {
    snapshot: SessionSnapshot,
    output_bytes: usize,
    command_tx: mpsc::Sender<ActorCommand>,
    publications: tokio::sync::broadcast::Sender<SessionSnapshot>,
    owner: String,
    attached: bool,
    inspection_slots: Arc<tokio::sync::Semaphore>,
}

/// Authoritative lookup for all live and recoverable debug sessions. Keeping
/// registry concerns separate from `DebugService` prevents routes from becoming
/// an accidental second owner of actor state.
#[derive(Debug, Clone, Default)]
struct DebugSessionRegistry {
    records: Arc<DashMap<String, Arc<Mutex<Record>>>>,
}

impl DebugSessionRegistry {
    fn insert(&self, id: String, record: Arc<Mutex<Record>>) {
        self.records.insert(id, record);
    }

    fn get(&self, id: &str) -> Option<Arc<Mutex<Record>>> {
        self.records.get(id).map(|entry| entry.value().clone())
    }

    fn all(&self) -> Vec<Arc<Mutex<Record>>> {
        self.records
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }
}

#[derive(Debug)]
enum ActorCommand {
    Stop {
        reply: oneshot::Sender<()>,
    },
    Detach,
    Execute {
        generation: Option<u64>,
        operation: super::DebugOperation,
        reply: oneshot::Sender<anyhow::Result<serde_json::Value>>,
    },
    SyncBreakpoints {
        file_id: String,
        revision: u64,
        breakpoints: Vec<super::RequestedSourceBreakpoint>,
    },
}

#[derive(Debug, Clone)]
pub struct DebugService {
    sessions: DebugSessionRegistry,
    strategies: StrategyRegistry,
    pub breakpoints: super::BreakpointRepository,
    publications: tokio::sync::broadcast::Sender<SessionSnapshot>,
}

impl DebugService {
    pub fn new() -> Self {
        let data_dir = std::env::var_os("FORGE_DEBUG_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir()
                    .join("forge-editor")
                    .join("debug-breakpoints")
            });
        let (publications, _) = tokio::sync::broadcast::channel(512);
        let sessions = DebugSessionRegistry::default();
        let breakpoints = super::BreakpointRepository::persistent(data_dir);
        let service = Self {
            sessions: sessions.clone(),
            strategies: StrategyRegistry::default(),
            breakpoints: breakpoints.clone(),
            publications,
        };
        let mut changes = breakpoints.subscribe();
        tokio::spawn(async move {
            loop {
                match changes.recv().await {
                    Ok(change) => {
                        let list = breakpoints.list(&change.workspace_id).await;
                        let source_breakpoints = list
                            .breakpoints
                            .into_iter()
                            .filter(|item| item.file_id == change.file_id)
                            .collect::<Vec<_>>();
                        let records = sessions.all();
                        for record in records {
                            let tx = {
                                let r = record.lock().await;
                                (r.snapshot.workspace_id == change.workspace_id
                                    && !matches!(
                                        r.snapshot.state,
                                        SessionState::Terminated
                                            | SessionState::Failed
                                            | SessionState::Terminating
                                    ))
                                .then(|| r.command_tx.clone())
                            };
                            if let Some(tx) = tx {
                                let _ = tx
                                    .send(ActorCommand::SyncBreakpoints {
                                        file_id: change.file_id.clone(),
                                        revision: change.revision,
                                        breakpoints: source_breakpoints.clone(),
                                    })
                                    .await;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        service
    }
    pub async fn configurations(
        &self,
        root: &std::path::Path,
        workspace: &str,
    ) -> anyhow::Result<ConfigurationList> {
        Ok(config::load(root, workspace, &self.strategies)
            .await?
            .public)
    }
    pub async fn create(
        &self,
        root: &std::path::Path,
        workspace: &str,
        request: CreateSession,
    ) -> anyhow::Result<SessionSnapshot> {
        if request
            .active_file_id
            .as_deref()
            .is_some_and(|p| p.contains(".."))
        {
            anyhow::bail!("activeFileId is invalid");
        }
        let loaded = config::load(root, workspace, &self.strategies).await?;
        anyhow::ensure!(
            !request.principal_id.is_empty() && request.principal_id.len() <= 128,
            "invalid debug principal"
        );
        if loaded.public.revision != request.configuration_revision {
            anyhow::bail!("stale configuration revision");
        }
        let configuration = loaded
            .resolved
            .get(&request.configuration_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("configuration is missing or invalid"))?;
        let strategy = self
            .strategies
            .get(&configuration.adapter_type)
            .ok_or_else(|| anyhow::anyhow!("debug adapter strategy is unavailable"))?;
        if self
            .sessions
            .records
            .iter()
            .filter(|entry| {
                entry.value().try_lock().is_ok_and(|r| {
                    r.snapshot.workspace_id == workspace
                        && !matches!(
                            r.snapshot.state,
                            SessionState::Terminated | SessionState::Failed
                        )
                })
            })
            .count()
            >= 2
        {
            anyhow::bail!("workspace debug session limit reached");
        }
        let breakpoint_list = self.breakpoints.list(workspace).await;
        let breakpoint_snapshot = breakpoint_list.breakpoints;
        let id = Uuid::new_v4().to_string();
        let snapshot = SessionSnapshot {
            session_id: id.clone(),
            workspace_id: workspace.into(),
            configuration_id: configuration.id.clone(),
            configuration_name: configuration.name.clone(),
            state: SessionState::Creating,
            event_cursor: 0,
            output: vec![],
            exit_code: None,
            error: None,
            capabilities: strategy.capabilities(),
            runtime_capabilities: Default::default(),
            stopped_generation: None,
            attachment_generation: 1,
            breakpoint_revision: breakpoint_list.revision,
            requested_breakpoints: breakpoint_snapshot.clone(),
            verified_breakpoints: vec![],
        };
        let (command_tx, command_rx) = mpsc::channel(32);
        let record = Arc::new(Mutex::new(Record {
            snapshot: snapshot.clone(),
            output_bytes: 0,
            command_tx,
            publications: self.publications.clone(),
            owner: request.principal_id,
            attached: false,
            inspection_slots: Arc::new(tokio::sync::Semaphore::new(
                super::limits::MAX_CONCURRENT_INSPECTION_REQUESTS,
            )),
        }));
        self.sessions.insert(id, record.clone());
        tokio::spawn(DebugSessionActor::run(
            record,
            configuration,
            strategy,
            root.to_path_buf(),
            breakpoint_snapshot,
            command_rx,
        ));
        Ok(snapshot)
    }
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<SessionSnapshot> {
        self.publications.subscribe()
    }
    pub async fn get(&self, workspace: &str, session: &str) -> anyhow::Result<SessionSnapshot> {
        let record = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug session not found"))?;
        let guard = record.lock().await;
        if guard.snapshot.workspace_id != workspace {
            anyhow::bail!("debug session not found")
        }
        Ok(guard.snapshot.clone())
    }
    pub async fn attach(
        &self,
        principal: &str,
        workspace: &str,
        session: &str,
        attachment: u64,
    ) -> anyhow::Result<SessionSnapshot> {
        let record = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug_session_not_found"))?;
        let mut r = record.lock().await;
        if r.snapshot.workspace_id != workspace || r.owner != principal {
            anyhow::bail!("debug_session_forbidden")
        }
        if r.snapshot.attachment_generation != attachment {
            anyhow::bail!("debug_stale_attachment")
        }
        r.attached = true;
        Ok(r.snapshot.clone())
    }
    pub async fn detach(
        &self,
        principal: &str,
        workspace: &str,
        session: &str,
        attachment: u64,
    ) -> anyhow::Result<SessionSnapshot> {
        let record = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug_session_not_found"))?;
        let mut r = record.lock().await;
        if r.snapshot.workspace_id != workspace || r.owner != principal {
            anyhow::bail!("debug_session_forbidden")
        }
        if r.snapshot.attachment_generation != attachment {
            anyhow::bail!("debug_stale_attachment")
        }
        r.attached = false;
        let tx = r.command_tx.clone();
        let snapshot = r.snapshot.clone();
        drop(r);
        let _ = tx.send(ActorCommand::Detach).await;
        Ok(snapshot)
    }
    pub async fn stop(
        &self,
        principal: &str,
        workspace: &str,
        session: &str,
    ) -> anyhow::Result<SessionSnapshot> {
        let record = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug session not found"))?;
        let r = record.lock().await;
        if r.snapshot.workspace_id != workspace || r.owner != principal {
            anyhow::bail!("debug_session_forbidden")
        }
        if !matches!(
            r.snapshot.state,
            SessionState::Terminated | SessionState::Failed
        ) {
            let tx = r.command_tx.clone();
            drop(r);
            let (reply_tx, reply_rx) = oneshot::channel();
            tx.send(ActorCommand::Stop { reply: reply_tx })
                .await
                .map_err(|_| anyhow::anyhow!("debug adapter failed"))?;
            let _ = tokio::time::timeout(Duration::from_secs(2), reply_rx).await;
            let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
            loop {
                let snapshot = self.get(workspace, session).await?;
                if matches!(
                    snapshot.state,
                    SessionState::Terminated | SessionState::Failed
                ) || tokio::time::Instant::now() >= deadline
                {
                    return Ok(snapshot);
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }
        Ok(r.snapshot.clone())
    }

    /// Restart is deliberately terminate-and-create. Adapter-native restart
    /// would make launch snapshots and stopped-handle authority ambiguous.
    pub async fn restart(
        &self,
        principal: &str,
        root: &std::path::Path,
        workspace: &str,
        session: &str,
    ) -> anyhow::Result<SessionSnapshot> {
        let previous = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug_session_not_found"))?;
        let configuration_id = {
            let record = previous.lock().await;
            if record.owner != principal || record.snapshot.workspace_id != workspace {
                anyhow::bail!("debug_session_forbidden")
            }
            record.snapshot.configuration_id.clone()
        };
        let terminal = self.stop(principal, workspace, session).await?;
        anyhow::ensure!(
            matches!(
                terminal.state,
                SessionState::Terminated | SessionState::Failed
            ),
            "debug_request_timeout"
        );
        let revision = config::load(root, workspace, &self.strategies)
            .await?
            .public
            .revision;
        self.create(
            root,
            workspace,
            CreateSession {
                configuration_id,
                configuration_revision: revision,
                active_file_id: None,
                principal_id: principal.to_string(),
            },
        )
        .await
    }

    pub async fn execute(
        &self,
        principal: &str,
        workspace: &str,
        session: &str,
        attachment_generation: u64,
        generation: Option<u64>,
        operation: super::DebugOperation,
    ) -> anyhow::Result<serde_json::Value> {
        let record = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug_session_not_found"))?;
        let r = record.lock().await;
        if r.owner != principal {
            anyhow::bail!("debug_session_forbidden")
        }
        if r.snapshot.workspace_id != workspace {
            anyhow::bail!("debug_session_forbidden")
        }
        if r.snapshot.attachment_generation != attachment_generation {
            anyhow::bail!("debug_stale_attachment")
        }
        if !r.attached {
            anyhow::bail!("debug_session_forbidden")
        }
        let is_pause = matches!(operation, super::DebugOperation::Pause { .. });
        if is_pause {
            if r.snapshot.state != SessionState::Running {
                anyhow::bail!("debug_not_running")
            }
            if !r.snapshot.runtime_capabilities.supports_pause {
                anyhow::bail!("debug_capability_unsupported")
            }
        } else {
            if r.snapshot.state != SessionState::Stopped {
                anyhow::bail!("debug_not_stopped")
            }
            if r.snapshot.stopped_generation != generation {
                anyhow::bail!("debug_stale_generation")
            }
        }
        let tx = r.command_tx.clone();
        let inspection_slots = r.inspection_slots.clone();
        drop(r);
        let _permit = inspection_slots
            .try_acquire_owned()
            .map_err(|_| anyhow::anyhow!("debug_busy"))?;
        let (reply, receive) = oneshot::channel();
        tx.send(ActorCommand::Execute {
            generation,
            operation,
            reply,
        })
        .await
        .map_err(|_| anyhow::anyhow!("debug_adapter_failed"))?;
        tokio::time::timeout(Duration::from_secs(10), receive)
            .await
            .map_err(|_| anyhow::anyhow!("debug_request_timeout"))?
            .map_err(|_| anyhow::anyhow!("debug_adapter_failed"))?
    }
}

fn transition(r: &mut Record, state: SessionState) {
    r.snapshot.state = state;
    r.snapshot.event_cursor += 1;
    let _ = r.publications.send(r.snapshot.clone());
}
fn output(r: &mut Record, category: &str, mut text: String) {
    if text.len() > 64 * 1024 {
        text.truncate(64 * 1024);
        text.push_str("\n[output truncated]");
    }
    while r.output_bytes + text.len() > MAX_OUTPUT_BYTES
        || r.snapshot.output.len() >= super::limits::MAX_CONSOLE_RECORDS
    {
        if let Some(old) = r.snapshot.output.first() {
            r.output_bytes = r.output_bytes.saturating_sub(old.output.len());
            r.snapshot.output.remove(0);
        } else {
            break;
        }
    }
    r.output_bytes += text.len();
    r.snapshot.event_cursor += 1;
    r.snapshot.output.push(OutputChunk {
        sequence: r.snapshot.event_cursor,
        category: category.into(),
        output: text,
    });
    let _ = r.publications.send(r.snapshot.clone());
}

type DapInput = Box<dyn AsyncRead + Unpin + Send>;
type DapOutput = Arc<Mutex<Box<dyn AsyncWrite + Unpin + Send>>>;

async fn write_dap(output: &DapOutput, message: &serde_json::Value) -> anyhow::Result<()> {
    let mut output = output.lock().await;
    Ok(dap::write_message(&mut **output, message).await?)
}

/// The only task allowed to read bytes from an adapter transport. Keeping the
/// framing reader here prevents nested request helpers from competing for DAP
/// messages and provides the seam for response/event/reverse-request dispatch.
struct DapInbox {
    messages: mpsc::Receiver<anyhow::Result<serde_json::Value>>,
    responses: HashMap<u64, serde_json::Value>,
}

impl DapInbox {
    fn spawn(input: DapInput, output: DapOutput) -> Self {
        let (tx, messages) = mpsc::channel(super::limits::MAX_PENDING_REQUESTS);
        tokio::spawn(async move {
            let mut reader = dap::Reader::new(input);
            loop {
                match reader.next().await {
                    Ok(Some(message)) if message["type"] == "request" => {
                        // Forge advertises no reverse-request capabilities in
                        // this phase. A valid failed response is safer than
                        // silently hanging the adapter or executing a command.
                        let response = json!({
                            "seq": message["seq"],
                            "type": "response",
                            "request_seq": message["seq"],
                            "success": false,
                            "command": message["command"],
                            "message": "Reverse request is not supported by Forge policy"
                        });
                        if write_dap(&output, &response).await.is_err() {
                            break;
                        }
                    }
                    Ok(Some(message)) => {
                        if tx.send(Ok(message)).await.is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = tx.send(Err(error)).await;
                        break;
                    }
                }
            }
        });
        Self {
            messages,
            responses: HashMap::new(),
        }
    }

    async fn next(&mut self) -> anyhow::Result<Option<serde_json::Value>> {
        match self.messages.recv().await {
            Some(Ok(message)) => Ok(Some(message)),
            Some(Err(error)) => Err(error),
            None => Ok(None),
        }
    }

    fn take_response(&mut self, request_seq: u64) -> Option<serde_json::Value> {
        self.responses.remove(&request_seq)
    }

    fn buffer_response(&mut self, response: serde_json::Value) -> bool {
        let Some(request_seq) = response["request_seq"].as_u64() else {
            return false;
        };
        if self.responses.len() >= super::limits::MAX_PENDING_REQUESTS {
            return false;
        }
        self.responses.insert(request_seq, response);
        true
    }
}

async fn spawn_adapter(
    adapter: &AdapterCommand,
    cwd: &std::path::Path,
) -> anyhow::Result<(
    Child,
    DapOutput,
    DapInput,
    Option<tokio::process::ChildStderr>,
)> {
    match &adapter.transport {
        AdapterTransport::Stdio => {
            let mut command = adapter_process(adapter, cwd);
            command.stdin(Stdio::piped()).stdout(Stdio::piped());
            let mut child = command.spawn()?;
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| anyhow::anyhow!("adapter stdin was not available"))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| anyhow::anyhow!("adapter stdout was not available"))?;
            let stderr = child.stderr.take();
            Ok((
                child,
                Arc::new(Mutex::new(Box::new(stdin))),
                Box::new(stdout),
                stderr,
            ))
        }
        AdapterTransport::Loopback { arguments } => {
            // Adapter sockets are ephemeral, loopback-only, and never exposed
            // through the public API. Releasing the reservation immediately
            // before spawn keeps the race window as small as practical.
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
            let address = listener.local_addr()?;
            drop(listener);
            let port = address.port().to_string();
            let mut command = adapter_process(adapter, cwd);
            command.args(
                arguments
                    .iter()
                    .map(|argument| argument.replace("{port}", &port)),
            );
            let mut child = command.spawn()?;
            let stderr = child.stderr.take();
            let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
            let stream = loop {
                match TcpStream::connect(address).await {
                    Ok(stream) => break stream,
                    Err(_) if tokio::time::Instant::now() < deadline => {
                        if child.try_wait()?.is_some() {
                            anyhow::bail!("adapter exited before accepting its DAP connection");
                        }
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                    Err(error) => return Err(error.into()),
                }
            };
            let (read, write) = stream.into_split();
            Ok((
                child,
                Arc::new(Mutex::new(Box::new(write))),
                Box::new(read),
                stderr,
            ))
        }
    }
}

fn adapter_process(adapter: &AdapterCommand, cwd: &std::path::Path) -> Command {
    let mut command = Command::new(&adapter.executable);
    command
        .args(&adapter.arguments)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .env_clear()
        .env("PATH", crate::services::process_env::tool_path())
        .kill_on_drop(true);
    for (name, value) in crate::services::process_env::tool_environment() {
        command.env(name, value);
    }
    command
}

/// One actor owns one adapter process and every piece of mutable protocol state
/// associated with that run.
struct DebugSessionActor;

impl DebugSessionActor {
    async fn run(
        record: Arc<Mutex<Record>>,
        config: ResolvedConfiguration,
        strategy: Arc<dyn DebugStrategy>,
        workspace_root: PathBuf,
        requested_breakpoints: Vec<super::RequestedSourceBreakpoint>,
        mut commands: mpsc::Receiver<ActorCommand>,
    ) {
        let session_id = record.lock().await.snapshot.session_id.clone();
        let mut handles = super::OpaqueHandleTable::default();
        let mut synchronized_breakpoint_revisions: BTreeMap<String, u64> = BTreeMap::new();
        let mut watches: BTreeMap<String, (String, bool, Option<serde_json::Value>)> =
            BTreeMap::new();
        {
            let mut r = record.lock().await;
            transition(&mut r, SessionState::SpawningAdapter);
        }
        let adapter = strategy.command();
        let (mut child, mut stdin, stdout, stderr) =
            match spawn_adapter(&adapter, &config.cwd).await {
                Ok(spawned) => spawned,
                Err(error) => {
                    let mut r = record.lock().await;
                    r.snapshot.error = Some(format!(
                        "{} is unavailable: {error}",
                        strategy.display_name()
                    ));
                    transition(&mut r, SessionState::Failed);
                    return;
                }
            };
        {
            let mut r = record.lock().await;
            transition(&mut r, SessionState::Initializing);
        }
        if let Some(stderr) = stderr {
            let stderr_record = record.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut stderr = stderr;
                let mut buf = vec![0; 8192];
                while let Ok(n) = stderr.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    let safe = String::from_utf8_lossy(&buf[..n]).replace('\r', "");
                    let mut r = stderr_record.lock().await;
                    output(&mut r, "adapter", safe);
                }
            });
        }
        if write_dap(&stdin,&dap::request(1,"initialize",json!({"clientID":"forge","clientName":"Forge","adapterID":adapter.adapter_id,"pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsRunInTerminalRequest":false}))).await.is_err() { fail(&record,"Debug adapter initialization failed.").await; return }
        let mut reader = DapInbox::spawn(stdout, stdin.clone());
        let initialized = wait_response_value(&mut reader, 1, &record).await;
        if initialized.is_none() {
            fail(&record, "Debug adapter did not initialize.").await;
            return;
        } else if let Some(body) = initialized.and_then(|v| v.get("body").cloned()) {
            let mut r = record.lock().await;
            r.snapshot.runtime_capabilities = super::RuntimeCapabilities {
                supports_configuration_done: body["supportsConfigurationDoneRequest"]
                    .as_bool()
                    .unwrap_or(false),
                supports_conditional_breakpoints: body["supportsConditionalBreakpoints"]
                    .as_bool()
                    .unwrap_or(false),
                supports_hit_conditional_breakpoints: body["supportsHitConditionalBreakpoints"]
                    .as_bool()
                    .unwrap_or(false),
                supports_log_points: body["supportsLogPoints"].as_bool().unwrap_or(false),
                supports_pause: true,
                supports_step_back: body["supportsStepBack"].as_bool().unwrap_or(false),
                supports_variable_paging: body["supportsVariablePaging"].as_bool().unwrap_or(false),
                supports_variable_type: body["supportsVariableType"].as_bool().unwrap_or(false),
                supports_value_formatting: body["supportsValueFormattingOptions"]
                    .as_bool()
                    .unwrap_or(false),
                supports_loaded_sources: body["supportsLoadedSourcesRequest"]
                    .as_bool()
                    .unwrap_or(false),
                limits: Default::default(),
            };
        }
        {
            let mut r = record.lock().await;
            transition(&mut r, SessionState::Launching);
        }
        let launch = strategy.launch_arguments(&config);
        if write_dap(&stdin, &dap::request(2, "launch", launch))
            .await
            .is_err()
        {
            fail(&record, "The debug target could not be launched.").await;
            return;
        }
        {
            let mut r = record.lock().await;
            transition(&mut r, SessionState::Configuring);
        }
        // DAP permits launch response and initialized event in either order. Wait
        // for initialized, retaining whether launch already completed, before
        // synchronizing complete per-source breakpoint lists.
        let mut launch_responded = match wait_initialized(&mut reader, &record).await {
            Some(v) => v,
            None => {
                fail(
                    &record,
                    "The debug adapter did not become ready for configuration.",
                )
                .await;
                return;
            }
        };
        let mut next_seq = 3u64;
        let initial_breakpoint_revision = record.lock().await.snapshot.breakpoint_revision;
        let mut grouped: BTreeMap<String, Vec<super::RequestedSourceBreakpoint>> = BTreeMap::new();
        for breakpoint in requested_breakpoints {
            grouped
                .entry(breakpoint.file_id.clone())
                .or_default()
                .push(breakpoint);
        }
        for (file_id, mut breakpoints) in grouped {
            breakpoints.sort_by_key(|b| (b.line, b.column));
            let relative = file_id.trim_start_matches('/');
            let source_path = workspace_root.join(relative);
            if !source_path.starts_with(&workspace_root) {
                continue;
            }
            let capabilities = record.lock().await.snapshot.runtime_capabilities.clone();
            let enabled = breakpoints
                .iter()
                .filter(|breakpoint| breakpoint.enabled)
                .cloned()
                .collect::<Vec<_>>();
            let payload = json!({"source":{"path":source_path},"breakpoints":dap_breakpoints(&enabled,&capabilities)});
            let response = if write_dap(&stdin, &dap::request(next_seq, "setBreakpoints", payload))
                .await
                .is_err()
            {
                None
            } else {
                wait_response_value_tracking(&mut reader, next_seq, &record, &mut launch_responded)
                    .await
            };
            if let Some(response) = response {
                admit_breakpoint_verification(
                    &record,
                    &session_id,
                    &file_id,
                    initial_breakpoint_revision,
                    &breakpoints,
                    &response,
                )
                .await;
            } else {
                fail(
                    &record,
                    "The debug adapter rejected breakpoint configuration.",
                )
                .await;
                return;
            }
            next_seq += 1;
        }
        let supports_configuration_done = record
            .lock()
            .await
            .snapshot
            .runtime_capabilities
            .supports_configuration_done;
        let completed = if supports_configuration_done {
            if write_dap(
                &stdin,
                &dap::request(next_seq, "configurationDone", json!({})),
            )
            .await
            .is_err()
            {
                false
            } else {
                wait_configuration_complete(&mut reader, next_seq, &record, &mut launch_responded)
                    .await
            }
        } else if launch_responded {
            true
        } else {
            wait_response(&mut reader, 2, &record).await
        };
        if !completed {
            fail(&record, "The debug target could not be launched.").await;
            return;
        }
        {
            let mut r = record.lock().await;
            transition(&mut r, SessionState::Running);
        }
        loop {
            tokio::select! {
                command = commands.recv() => match command {
                    Some(ActorCommand::Stop{reply}) => {
                        { let mut r=record.lock().await; transition(&mut r,SessionState::Terminating); }
                        let _=write_dap(&stdin,&dap::request(next_seq+1,"disconnect",json!({"terminateDebuggee":true}))).await;
                        let _=reply.send(()); break;
                    }
                    Some(ActorCommand::Detach) => {
                        handles.reset(&session_id, 0);
                    }
                    Some(ActorCommand::Execute{generation,operation,reply}) => {
                        let is_pause=matches!(operation,super::DebugOperation::Pause{..});
                        if !is_pause && record.lock().await.snapshot.stopped_generation!=generation { let _=reply.send(Err(anyhow::anyhow!("debug_stale_generation"))); continue; }
                        let result=execute_actor_command(&mut stdin,&mut reader,&mut next_seq,&session_id,generation.unwrap_or(0),&workspace_root,&mut handles,&mut watches,operation,&record).await;
                        let _=reply.send(result);
                    }
                    Some(ActorCommand::SyncBreakpoints{file_id,revision,mut breakpoints}) => {
                        if synchronized_breakpoint_revisions.get(&file_id).is_some_and(|current|*current>=revision){continue}
                        breakpoints.sort_by_key(|item|(item.line,item.column));next_seq+=1;
                        let path=workspace_root.join(file_id.trim_start_matches('/'));
                        if path.starts_with(&workspace_root){let capabilities=record.lock().await.snapshot.runtime_capabilities.clone();let enabled=breakpoints.iter().filter(|item|item.enabled).cloned().collect::<Vec<_>>();let payload=json!({"source":{"path":path},"breakpoints":dap_breakpoints(&enabled,&capabilities)});if write_dap(&stdin,&dap::request(next_seq,"setBreakpoints",payload)).await.is_ok(){if let Some(response)=wait_response_value(&mut reader,next_seq,&record).await {admit_breakpoint_verification(&record,&session_id,&file_id,revision,&breakpoints,&response).await;synchronized_breakpoint_revisions.insert(file_id,revision);}}}
                    }
                    None => break,
                },
                message = reader.next() => match message {
                Ok(Some(message)) => {
                    let event=message.get("event").and_then(|v|v.as_str()).map(str::to_owned);
                    if message["type"] == "response" {
                        if !reader.buffer_response(message) {
                            fail(&record, "The debug adapter exceeded the pending response limit.").await;
                            break;
                        }
                    } else {
                        handle_message(&record, message).await;
                    }
                    if event.as_deref()==Some("stopped") { if let Some(g)=record.lock().await.snapshot.stopped_generation { handles.reset(&session_id,g); } }
                    if matches!(event.as_deref(),Some("continued")|Some("terminated")) { handles.reset(&session_id,0); }
                },
                Ok(None) => break,
                Err(_) => {
                    fail(&record, "The debug adapter sent an invalid message.").await;
                    return;
                }
                }
            }
            if matches!(
                record.lock().await.snapshot.state,
                SessionState::Terminated | SessionState::Failed
            ) {
                break;
            }
        }
        let _ = child.start_kill();
        let _ = child.wait().await;
        let mut r = record.lock().await;
        if !matches!(r.snapshot.state, SessionState::Failed) {
            transition(&mut r, SessionState::Terminated);
        }
    }
}
fn dap_breakpoints(
    items: &[super::RequestedSourceBreakpoint],
    capabilities: &super::RuntimeCapabilities,
) -> Vec<serde_json::Value> {
    items
        .iter()
        .map(|item| {
            let mut value = serde_json::Map::new();
            value.insert("line".into(), json!(item.line + 1));
            if let Some(column) = item.column {
                value.insert("column".into(), json!(column + 1));
            }
            if capabilities.supports_conditional_breakpoints {
                if let Some(condition) = &item.condition {
                    value.insert("condition".into(), json!(condition));
                }
            }
            if capabilities.supports_hit_conditional_breakpoints {
                if let Some(condition) = &item.hit_condition {
                    value.insert("hitCondition".into(), json!(condition));
                }
            }
            if capabilities.supports_log_points {
                if let Some(message) = &item.log_message {
                    value.insert("logMessage".into(), json!(message));
                }
            }
            serde_json::Value::Object(value)
        })
        .collect()
}
async fn wait_initialized(reader: &mut DapInbox, record: &Arc<Mutex<Record>>) -> Option<bool> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let mut launch_responded = match reader.take_response(2) {
        Some(response) if response["success"].as_bool().unwrap_or(false) => true,
        Some(_) => return None,
        None => false,
    };
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(1), reader.next()).await {
            Ok(Ok(Some(v))) if v["type"] == "event" && v["event"] == "initialized" => {
                return Some(launch_responded);
            }
            Ok(Ok(Some(v))) if v["type"] == "response" && v["request_seq"] == 2 => {
                if !v["success"].as_bool().unwrap_or(false) {
                    return None;
                }
                launch_responded = true;
            }
            Ok(Ok(Some(v))) if v["type"] == "response" => {
                if !reader.buffer_response(v) {
                    return None;
                }
            }
            Ok(Ok(Some(v))) => handle_message(record, v).await,
            Ok(Ok(None)) | Ok(Err(_)) => return None,
            Err(_) => {}
        }
    }
    None
}
async fn wait_response_value_tracking(
    reader: &mut DapInbox,
    target: u64,
    record: &Arc<Mutex<Record>>,
    launch: &mut bool,
) -> Option<serde_json::Value> {
    if let Some(response) = reader.take_response(target) {
        return response["success"]
            .as_bool()
            .unwrap_or(false)
            .then_some(response);
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(1), reader.next()).await {
            Ok(Ok(Some(v))) if v["type"] == "response" && v["request_seq"] == target => {
                return v["success"].as_bool().unwrap_or(false).then_some(v);
            }
            Ok(Ok(Some(v))) if v["type"] == "response" && v["request_seq"] == 2 => {
                if !v["success"].as_bool().unwrap_or(false) {
                    return None;
                }
                *launch = true;
            }
            Ok(Ok(Some(v))) if v["type"] == "response" => {
                if !reader.buffer_response(v) {
                    return None;
                }
            }
            Ok(Ok(Some(v))) => handle_message(record, v).await,
            Ok(Ok(None)) | Ok(Err(_)) => return None,
            Err(_) => {}
        }
    }
    None
}

async fn admit_breakpoint_verification(
    record: &Arc<Mutex<Record>>,
    session_id: &str,
    file_id: &str,
    revision: u64,
    requested_for_source: &[super::RequestedSourceBreakpoint],
    response: &serde_json::Value,
) {
    let mut r = record.lock().await;
    // A response for an older intent revision must never replace newer state.
    if revision < r.snapshot.breakpoint_revision {
        return;
    }
    r.snapshot.breakpoint_revision = revision;
    r.snapshot
        .requested_breakpoints
        .retain(|breakpoint| breakpoint.file_id != file_id);
    r.snapshot
        .requested_breakpoints
        .extend(requested_for_source.iter().cloned());
    r.snapshot.requested_breakpoints.sort_by(|a, b| {
        (&a.file_id, a.line, a.column, &a.breakpoint_id).cmp(&(
            &b.file_id,
            b.line,
            b.column,
            &b.breakpoint_id,
        ))
    });
    r.snapshot.verified_breakpoints.retain(|verification| {
        !requested_for_source
            .iter()
            .any(|requested| requested.breakpoint_id == verification.requested_breakpoint_id)
    });
    let adapter_results = response["body"]["breakpoints"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let workspace_id = r.snapshot.workspace_id.clone();
    for (requested, adapter) in requested_for_source
        .iter()
        .filter(|breakpoint| breakpoint.enabled)
        .zip(adapter_results.iter())
    {
        r.snapshot
            .verified_breakpoints
            .push(super::VerifiedBreakpoint {
                requested_breakpoint_id: requested.breakpoint_id.clone(),
                adapter_breakpoint_id: adapter["id"].as_i64(),
                verified: adapter["verified"].as_bool().unwrap_or(false),
                resolved_source: Some(super::PublicSource::Workspace {
                    workspace_id: workspace_id.clone(),
                    file_id: file_id.to_string(),
                }),
                resolved_line: adapter["line"]
                    .as_u64()
                    .map(|line| line.saturating_sub(1) as u32),
                resolved_column: adapter["column"]
                    .as_u64()
                    .map(|column| column.saturating_sub(1) as u32),
                message: adapter["message"].as_str().map(str::to_owned),
                session_id: session_id.to_string(),
            });
    }
    // Missing adapter entries are explicit rejected/uncertain results instead
    // of being silently mistaken for an unconfigured breakpoint.
    for requested in requested_for_source
        .iter()
        .filter(|breakpoint| breakpoint.enabled)
        .skip(adapter_results.len())
    {
        r.snapshot
            .verified_breakpoints
            .push(super::VerifiedBreakpoint {
                requested_breakpoint_id: requested.breakpoint_id.clone(),
                adapter_breakpoint_id: None,
                verified: false,
                resolved_source: None,
                resolved_line: None,
                resolved_column: None,
                message: Some("The adapter did not return a breakpoint result.".into()),
                session_id: session_id.to_string(),
            });
    }
    r.snapshot.event_cursor += 1;
    let _ = r.publications.send(r.snapshot.clone());
}
async fn wait_configuration_complete(
    reader: &mut DapInbox,
    configuration_seq: u64,
    record: &Arc<Mutex<Record>>,
    launch: &mut bool,
) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    if let Some(response) = reader.take_response(2) {
        if !response["success"].as_bool().unwrap_or(false) {
            return false;
        }
        *launch = true;
    }
    let mut configured = match reader.take_response(configuration_seq) {
        Some(response) if response["success"].as_bool().unwrap_or(false) => true,
        Some(_) => return false,
        None => false,
    };
    while tokio::time::Instant::now() < deadline && (!*launch || !configured) {
        match tokio::time::timeout(Duration::from_secs(1), reader.next()).await {
            Ok(Ok(Some(v))) if v["type"] == "response" => {
                let success = v["success"].as_bool().unwrap_or(false);
                match v["request_seq"].as_u64() {
                    Some(2) => {
                        if !success {
                            return false;
                        }
                        *launch = true
                    }
                    Some(seq) if seq == configuration_seq => {
                        if !success {
                            return false;
                        }
                        configured = true
                    }
                    _ => {
                        if !reader.buffer_response(v) {
                            return false;
                        }
                    }
                }
            }
            Ok(Ok(Some(v))) => handle_message(record, v).await,
            Ok(Ok(None)) | Ok(Err(_)) => return false,
            Err(_) => {}
        }
    }
    *launch && configured
}

async fn execute_actor_command(
    writer: &DapOutput,
    reader: &mut DapInbox,
    seq: &mut u64,
    session: &str,
    generation: u64,
    root: &std::path::Path,
    handles: &mut super::OpaqueHandleTable,
    watches: &mut BTreeMap<String, (String, bool, Option<serde_json::Value>)>,
    operation: super::DebugOperation,
    record: &Arc<Mutex<Record>>,
) -> anyhow::Result<serde_json::Value> {
    use super::DebugOperation::*;
    match operation {
        WatchCreate {
            expression,
            auto_refresh,
        } => {
            if expression.len() > super::limits::MAX_EXPRESSION_BYTES
                || watches.len() >= super::limits::MAX_WATCHES
            {
                anyhow::bail!("debug_result_too_large")
            }
            let id = Uuid::new_v4().to_string();
            watches.insert(id.clone(), (expression.clone(), auto_refresh, None));
            Ok(json!({"watchId":id,"expression":expression,"autoRefresh":auto_refresh}))
        }
        WatchUpdate {
            watch_id,
            expression,
            auto_refresh,
        } => {
            let watch = watches
                .get_mut(&watch_id)
                .ok_or_else(|| anyhow::anyhow!("debug_stale_handle"))?;
            if let Some(value) = expression {
                if value.len() > super::limits::MAX_EXPRESSION_BYTES {
                    anyhow::bail!("debug_result_too_large")
                }
                watch.0 = value;
            }
            if let Some(value) = auto_refresh {
                watch.1 = value;
            }
            watch.2 = None;
            Ok(json!({"watchId":watch_id,"expression":watch.0,"autoRefresh":watch.1}))
        }
        WatchDelete { watch_id } => {
            if watches.remove(&watch_id).is_none() {
                anyhow::bail!("debug_stale_handle")
            }
            Ok(json!({"watchId":watch_id}))
        }
        WatchRefresh { watch_id } => {
            let expression = watches
                .get(&watch_id)
                .ok_or_else(|| anyhow::anyhow!("debug_stale_handle"))?
                .0
                .clone();
            *seq += 1;
            let result = execute_operation(
                writer,
                reader,
                *seq,
                session,
                generation,
                root,
                handles,
                Evaluate {
                    expression,
                    frame_handle: None,
                    context: super::EvaluationContext::Watch,
                },
                record,
            )
            .await?;
            watches.get_mut(&watch_id).unwrap().2 = Some(result.clone());
            Ok(json!({"watchId":watch_id,"result":result}))
        }
        Pause {
            thread_handle: None,
        } => {
            // DAP requires a threadId for pause, while Forge intentionally
            // permits the browser to request a session-level pause. Resolve a
            // bounded current thread inside the actor; raw IDs stay private.
            handles.reset(session, generation);
            *seq += 1;
            let threads = execute_operation(
                writer, reader, *seq, session, generation, root, handles, Threads, record,
            )
            .await?;
            let handle = threads["threads"]
                .as_array()
                .and_then(|threads| threads.first())
                .and_then(|thread| thread["threadHandle"].as_str())
                .ok_or_else(|| anyhow::anyhow!("debug_thread_not_found"))?
                .to_owned();
            *seq += 1;
            execute_operation(
                writer,
                reader,
                *seq,
                session,
                generation,
                root,
                handles,
                Pause {
                    thread_handle: Some(handle),
                },
                record,
            )
            .await
        }
        operation => {
            *seq += 1;
            execute_operation(
                writer, reader, *seq, session, generation, root, handles, operation, record,
            )
            .await
        }
    }
}

async fn execute_operation(
    writer: &DapOutput,
    reader: &mut DapInbox,
    seq: u64,
    session: &str,
    generation: u64,
    root: &std::path::Path,
    handles: &mut super::OpaqueHandleTable,
    operation: super::DebugOperation,
    record: &Arc<Mutex<Record>>,
) -> anyhow::Result<serde_json::Value> {
    use super::DebugOperation::*;
    let runtime_capabilities = record.lock().await.snapshot.runtime_capabilities.clone();
    let (command, args, resume) = match &operation {
        Threads => ("threads", json!({}), false),
        StackTrace {
            thread_handle,
            start_frame,
            levels,
        } => {
            let id = handles.thread(session, generation, thread_handle)?;
            let levels = levels.unwrap_or(super::limits::DEFAULT_STACK_LEVELS);
            if levels > super::limits::MAX_STACK_LEVELS {
                anyhow::bail!("debug_result_too_large")
            }
            (
                "stackTrace",
                json!({"threadId":id,"startFrame":start_frame.unwrap_or(0),"levels":levels}),
                false,
            )
        }
        Scopes { frame_handle } => {
            let id = handles.frame(session, generation, frame_handle)?;
            ("scopes", json!({"frameId":id}), false)
        }
        Variables {
            variables_handle,
            filter,
            start,
            count,
        } => {
            let (id, _) = handles.variables(session, generation, variables_handle)?;
            let count = count.unwrap_or(super::limits::DEFAULT_VARIABLES_PER_PAGE);
            if count > super::limits::MAX_VARIABLES_PER_PAGE {
                anyhow::bail!("debug_result_too_large")
            }
            let args = if runtime_capabilities.supports_variable_paging {
                json!({"variablesReference":id,"filter":filter,"start":start.unwrap_or(0),"count":count})
            } else {
                json!({"variablesReference":id,"filter":filter})
            };
            ("variables", args, false)
        }
        Evaluate {
            expression,
            frame_handle,
            context,
        } => {
            if expression.len() > super::limits::MAX_EXPRESSION_BYTES {
                anyhow::bail!("debug_result_too_large")
            }
            let frame = frame_handle
                .as_ref()
                .map(|h| handles.frame(session, generation, h))
                .transpose()?;
            (
                "evaluate",
                json!({"expression":expression,"frameId":frame,"context":match context{super::EvaluationContext::Repl=>"repl",super::EvaluationContext::Watch=>"watch"}}),
                false,
            )
        }
        Source { source_handle } => {
            let reference = handles.source(session, generation, source_handle)?;
            ("source", json!({"sourceReference":reference}), false)
        }
        Continue { thread_handle } => {
            let id = handles.thread(session, generation, thread_handle)?;
            ("continue", json!({"threadId":id}), true)
        }
        Pause { thread_handle } => {
            let id = thread_handle
                .as_ref()
                .map(|h| handles.thread(session, generation, h))
                .transpose()?;
            ("pause", json!({"threadId":id}), false)
        }
        Next { thread_handle } => {
            let id = handles.thread(session, generation, thread_handle)?;
            ("next", json!({"threadId":id}), true)
        }
        StepIn { thread_handle } => {
            let id = handles.thread(session, generation, thread_handle)?;
            ("stepIn", json!({"threadId":id}), true)
        }
        StepOut { thread_handle } => {
            let id = handles.thread(session, generation, thread_handle)?;
            ("stepOut", json!({"threadId":id}), true)
        }
        WatchCreate { .. } | WatchUpdate { .. } | WatchDelete { .. } | WatchRefresh { .. } => {
            anyhow::bail!("debug_adapter_failed")
        }
    };
    write_dap(writer, &dap::request(seq, command, args)).await?;
    if resume {
        let mut r = record.lock().await;
        r.snapshot.stopped_generation = None;
        transition(&mut r, SessionState::Running);
        handles.reset(session, 0);
    }
    let response = wait_response_value(reader, seq, record)
        .await
        .ok_or_else(|| anyhow::anyhow!("debug_request_timeout"))?;
    if !resume && record.lock().await.snapshot.stopped_generation != Some(generation) {
        anyhow::bail!("debug_stale_generation")
    }
    let body = &response["body"];
    let workspace_id = record.lock().await.snapshot.workspace_id.clone();
    Ok(match operation {
        Threads => {
            let values = body["threads"].as_array().cloned().unwrap_or_default();
            let truncated = values.len() > super::limits::MAX_THREADS;
            let threads=values.into_iter().take(super::limits::MAX_THREADS).map(|v|json!({"threadHandle":handles.issue_thread(v["id"].as_i64().unwrap_or_default()),"name":v["name"].as_str().unwrap_or("Thread")})).collect::<Vec<_>>();
            json!({"sessionId":session,"stoppedGeneration":generation,"threads":threads,"truncated":truncated})
        }
        StackTrace {
            start_frame,
            levels,
            ..
        } => {
            let values = body["stackFrames"].as_array().cloned().unwrap_or_default();
            let mut frames = Vec::new();
            for v in values {
                let Some(id) = v["id"].as_i64() else { continue };
                let source = map_source(&v["source"], root, &workspace_id, session, handles);
                frames.push(json!({"frameHandle":handles.issue_frame(id)?,"name":v["name"].as_str().unwrap_or("Frame"),"source":source,"line":super::dap_to_public(v["line"].as_u64().unwrap_or(1),true).unwrap_or(0),"column":v["column"].as_u64().and_then(|n|super::dap_to_public(n,true))}));
            }
            let total = body["totalFrames"].as_u64();
            let start = u64::from(start_frame.unwrap_or(0));
            let requested = u64::from(levels.unwrap_or(super::limits::DEFAULT_STACK_LEVELS));
            let truncated = total
                .map(|total| start + (frames.len() as u64) < total)
                .unwrap_or(frames.len() as u64 >= requested);
            json!({"sessionId":session,"stoppedGeneration":generation,"frames":frames,"totalFrames":total,"truncated":truncated})
        }
        Scopes { .. } => {
            let values = body["scopes"].as_array().cloned().unwrap_or_default();
            let truncated = values.len() > super::limits::MAX_SCOPES_PER_FRAME;
            let mut scopes = Vec::new();
            for v in values.into_iter().take(super::limits::MAX_SCOPES_PER_FRAME) {
                let Some(id) = v["variablesReference"].as_i64() else {
                    continue;
                };
                scopes.push(json!({"name":v["name"].as_str().unwrap_or("Scope"),"variablesHandle":handles.issue_variables(id,0)?,"expensive":v["expensive"].as_bool().unwrap_or(false)}));
            }
            json!({"sessionId":session,"stoppedGeneration":generation,"scopes":scopes,"truncated":truncated})
        }
        Variables {
            variables_handle, ..
        } => {
            let (_, depth) = handles.variables(session, generation, &variables_handle)?;
            let values = body["variables"].as_array().cloned().unwrap_or_default();
            let truncated = values.len() > super::limits::MAX_VARIABLES_PER_PAGE as usize;
            let mut variables = Vec::new();
            for v in values
                .into_iter()
                .take(super::limits::MAX_VARIABLES_PER_PAGE as usize)
            {
                let (value, value_truncated) =
                    super::bounded_display(v["value"].as_str().unwrap_or("").to_owned());
                let child = match v["variablesReference"].as_i64().filter(|n| *n != 0) {
                    Some(id) => Some(handles.issue_variables(id, depth + 1)?),
                    None => None,
                };
                variables.push(json!({"name":v["name"].as_str().unwrap_or(""),"value":value,"type":v["type"].as_str(),"variablesHandle":child,"valueTruncated":value_truncated}));
            }
            json!({"sessionId":session,"stoppedGeneration":generation,"variables":variables,"truncated":truncated})
        }
        Evaluate { .. } => {
            let (value, value_truncated) =
                super::bounded_display(body["result"].as_str().unwrap_or("").to_owned());
            let child = body["variablesReference"]
                .as_i64()
                .filter(|n| *n != 0)
                .map(|id| handles.issue_variables(id, 0))
                .transpose()?;
            json!({"sessionId":session,"stoppedGeneration":generation,"value":value,"type":body["type"].as_str(),"variablesHandle":child,"valueTruncated":value_truncated})
        }
        Source { source_handle } => {
            let content = body["content"].as_str().unwrap_or("");
            if content.len() > super::limits::MAX_SOURCE_BYTES {
                anyhow::bail!("debug_result_too_large")
            }
            let safe_name = handles.source_name(session, generation, &source_handle)?;
            json!({"sessionId":session,"stoppedGeneration":generation,"content":content,"name":safe_name,"mimeType":body["mimeType"].as_str(),"truncated":false})
        }
        Continue { .. } | Pause { .. } | Next { .. } | StepIn { .. } | StepOut { .. } => {
            json!({"sessionId":session,"stoppedGeneration":record.lock().await.snapshot.stopped_generation,"state":record.lock().await.snapshot.state})
        }
        WatchCreate { .. } | WatchUpdate { .. } | WatchDelete { .. } | WatchRefresh { .. } => {
            unreachable!()
        }
    })
}

fn map_source(
    value: &serde_json::Value,
    root: &std::path::Path,
    workspace: &str,
    session: &str,
    handles: &mut super::OpaqueHandleTable,
) -> serde_json::Value {
    if let Some(path) = value["path"].as_str() {
        if let Ok(canonical) = std::path::Path::new(path).canonicalize() {
            if let Ok(relative) = canonical.strip_prefix(root) {
                return json!({"kind":"workspace","workspace_id":workspace,"file_id":format!("/{}",relative.to_string_lossy().replace('\\',"/"))});
            }
        }
    }
    if let Some(reference) = value["sourceReference"].as_i64().filter(|n| *n != 0) {
        return json!({"kind":"generated","session_id":session,"source_handle":handles.issue_source(reference,value["name"].as_str().map(str::to_owned)),"name":value["name"].as_str()});
    }
    json!({"kind":"unavailable","safe_name":value["name"].as_str(),"reason":"Source is outside the workspace"})
}
async fn wait_response(reader: &mut DapInbox, seq: u64, record: &Arc<Mutex<Record>>) -> bool {
    if let Some(response) = reader.take_response(seq) {
        return response["success"].as_bool().unwrap_or(false);
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(1), reader.next()).await {
            Ok(Ok(Some(v))) if v["type"] == "response" && v["request_seq"] == seq => {
                return v["success"].as_bool().unwrap_or(false);
            }
            Ok(Ok(Some(v))) if v["type"] == "response" => {
                if !reader.buffer_response(v) {
                    return false;
                }
            }
            Ok(Ok(Some(v))) => handle_message(record, v).await,
            Ok(Ok(None)) | Ok(Err(_)) => return false,
            Err(_) => {}
        }
    }
    false
}
async fn wait_response_value(
    reader: &mut DapInbox,
    seq: u64,
    record: &Arc<Mutex<Record>>,
) -> Option<serde_json::Value> {
    if let Some(response) = reader.take_response(seq) {
        return response["success"]
            .as_bool()
            .unwrap_or(false)
            .then_some(response);
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(1), reader.next()).await {
            Ok(Ok(Some(v))) if v["type"] == "response" && v["request_seq"] == seq => {
                return v["success"].as_bool().unwrap_or(false).then_some(v);
            }
            Ok(Ok(Some(v))) if v["type"] == "response" => {
                if !reader.buffer_response(v) {
                    return None;
                }
            }
            Ok(Ok(Some(v))) => handle_message(record, v).await,
            Ok(Ok(None)) | Ok(Err(_)) => return None,
            Err(_) => {}
        }
    }
    None
}
async fn handle_message(record: &Arc<Mutex<Record>>, v: serde_json::Value) {
    if v["type"] != "event" {
        return;
    }
    let mut r = record.lock().await;
    match v["event"].as_str() {
        Some("output") => output(
            &mut r,
            v["body"]["category"].as_str().unwrap_or("console"),
            v["body"]["output"].as_str().unwrap_or("").to_string(),
        ),
        Some("exited") => r.snapshot.exit_code = v["body"]["exitCode"].as_i64().map(|n| n as i32),
        Some("terminated") => transition(&mut r, SessionState::Terminated),
        Some("stopped") => {
            let generation = r.snapshot.stopped_generation.unwrap_or(0) + 1;
            r.snapshot.stopped_generation = Some(generation);
            transition(&mut r, SessionState::Stopped);
        }
        Some("continued") => {
            r.snapshot.stopped_generation = None;
            transition(&mut r, SessionState::Running);
        }
        Some("breakpoint") => {
            let changed = &v["body"]["breakpoint"];
            let adapter_id = changed["id"].as_i64();
            if let Some(verification) = adapter_id.and_then(|id| {
                r.snapshot
                    .verified_breakpoints
                    .iter_mut()
                    .find(|verification| verification.adapter_breakpoint_id == Some(id))
            }) {
                verification.verified = changed["verified"].as_bool().unwrap_or(false);
                verification.resolved_line = changed["line"]
                    .as_u64()
                    .map(|line| line.saturating_sub(1) as u32);
                verification.resolved_column = changed["column"]
                    .as_u64()
                    .map(|column| column.saturating_sub(1) as u32);
                verification.message = changed["message"].as_str().map(str::to_owned);
            } else {
                // Without a stable adapter ID, correlating by line would guess.
                // Mark the published verification uncertain until the next
                // complete setBreakpoints reconciliation.
                for verification in &mut r.snapshot.verified_breakpoints {
                    verification.verified = false;
                    verification.message = Some(
                        "Breakpoint verification changed; awaiting a complete adapter refresh."
                            .into(),
                    );
                }
            }
            r.snapshot.event_cursor += 1;
            let _ = r.publications.send(r.snapshot.clone());
        }
        _ => {}
    }
}
async fn fail(record: &Arc<Mutex<Record>>, message: &str) {
    let mut r = record.lock().await;
    r.snapshot.error = Some(message.into());
    transition(&mut r, SessionState::Failed);
}

#[cfg(test)]
mod actor_tests {
    use super::*;
    #[tokio::test]
    async fn continuous_reader_rejects_reverse_requests_and_keeps_dispatching() {
        let (client, server) = tokio::io::duplex(16 * 1024);
        let (client_read, client_write) = tokio::io::split(client);
        let (server_read, mut server_write) = tokio::io::split(server);
        let client_output: DapOutput = Arc::new(Mutex::new(Box::new(client_write)));
        let mut inbox = DapInbox::spawn(Box::new(client_read), client_output);

        dap::write_message(
            &mut server_write,
            &json!({"seq":7,"type":"request","command":"runInTerminal","arguments":{"args":["forbidden"]}}),
        )
        .await
        .unwrap();
        dap::write_message(
            &mut server_write,
            &json!({"seq":8,"type":"event","event":"stopped","body":{"reason":"pause"}}),
        )
        .await
        .unwrap();

        let forwarded = inbox.next().await.unwrap().unwrap();
        assert_eq!(forwarded["event"], "stopped");
        let mut adapter_responses = dap::Reader::new(server_read);
        let rejected = adapter_responses.next().await.unwrap().unwrap();
        assert_eq!(rejected["type"], "response");
        assert_eq!(rejected["request_seq"], 7);
        assert_eq!(rejected["success"], false);
        assert_eq!(rejected["command"], "runInTerminal");
    }

    #[tokio::test]
    async fn fake_adapter_inspection_uses_only_opaque_generation_handles() {
        let root = std::env::temp_dir().join(format!("forge-dap-fixture-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let source = root.join("main.rs");
        std::fs::write(&source, "fn main() {}\n").unwrap();
        let source = source.canonicalize().unwrap();
        let (client, server) = tokio::io::duplex(64 * 1024);
        let (client_read, client_write) = tokio::io::split(client);
        let (server_read, mut server_write) = tokio::io::split(server);
        tokio::spawn(async move {
            let mut reader = dap::Reader::new(server_read);
            while let Ok(Some(request)) = reader.next().await {
                let command = request["command"].as_str().unwrap();
                let body = match command {
                    "threads" => json!({"threads":[{"id":9007199254740993i64,"name":"main"}]}),
                    "stackTrace" => {
                        json!({"stackFrames":[{"id":77,"name":"main","line":1,"column":1,"source":{"path":source}},{"id":78,"name":"generated","line":2,"source":{"name":"generated.rs","sourceReference":42}}],"totalFrames":2})
                    }
                    "scopes" => {
                        json!({"scopes":[{"name":"Locals","variablesReference":9,"expensive":false}]})
                    }
                    "variables" => {
                        json!({"variables":[{"name":"answer","value":"42","type":"i32","variablesReference":0}]})
                    }
                    "evaluate" => json!({"result":"42","type":"i32","variablesReference":0}),
                    "source" => json!({"content":"generated()\n","mimeType":"text/x-rust"}),
                    _ => json!({}),
                };
                let response = json!({"seq":request["seq"].as_u64().unwrap()+100,"type":"response","request_seq":request["seq"],"success":true,"command":command,"body":body});
                dap::write_message(&mut server_write, &response)
                    .await
                    .unwrap();
            }
        });
        let (tx, _) = mpsc::channel(1);
        let (publications, _) = tokio::sync::broadcast::channel(8);
        let record = Arc::new(Mutex::new(Record {
            snapshot: SessionSnapshot {
                session_id: "session".into(),
                workspace_id: "workspace".into(),
                configuration_id: "c".into(),
                configuration_name: "C".into(),
                state: SessionState::Stopped,
                event_cursor: 0,
                output: vec![],
                exit_code: None,
                error: None,
                capabilities: Default::default(),
                runtime_capabilities: Default::default(),
                stopped_generation: Some(1),
                attachment_generation: 1,
                breakpoint_revision: 0,
                requested_breakpoints: vec![],
                verified_breakpoints: vec![],
            },
            output_bytes: 0,
            command_tx: tx,
            publications,
            owner: "owner".into(),
            attached: true,
            inspection_slots: Arc::new(tokio::sync::Semaphore::new(
                super::super::limits::MAX_CONCURRENT_INSPECTION_REQUESTS,
            )),
        }));
        let client_output: DapOutput = Arc::new(Mutex::new(Box::new(client_write)));
        let mut reader = DapInbox::spawn(Box::new(client_read), client_output.clone());
        let mut handles = super::super::OpaqueHandleTable::default();
        handles.reset("session", 1);
        let threads = execute_operation(
            &client_output,
            &mut reader,
            1,
            "session",
            1,
            &root,
            &mut handles,
            super::super::DebugOperation::Threads,
            &record,
        )
        .await
        .unwrap();
        let thread = threads["threads"][0]["threadHandle"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(!thread.contains("9007199254740993"));
        let stack = execute_operation(
            &client_output,
            &mut reader,
            2,
            "session",
            1,
            &root,
            &mut handles,
            super::super::DebugOperation::StackTrace {
                thread_handle: thread,
                start_frame: None,
                levels: None,
            },
            &record,
        )
        .await
        .unwrap();
        assert_eq!(stack["frames"][0]["source"]["file_id"], "/main.rs");
        assert!(
            stack["frames"][1]["source"]
                .get("sourceReference")
                .is_none()
        );
        let frame = stack["frames"][0]["frameHandle"]
            .as_str()
            .unwrap()
            .to_owned();
        let scopes = execute_operation(
            &client_output,
            &mut reader,
            3,
            "session",
            1,
            &root,
            &mut handles,
            super::super::DebugOperation::Scopes {
                frame_handle: frame,
            },
            &record,
        )
        .await
        .unwrap();
        let variables = scopes["scopes"][0]["variablesHandle"]
            .as_str()
            .unwrap()
            .to_owned();
        let values = execute_operation(
            &client_output,
            &mut reader,
            4,
            "session",
            1,
            &root,
            &mut handles,
            super::super::DebugOperation::Variables {
                variables_handle: variables,
                filter: None,
                start: None,
                count: None,
            },
            &record,
        )
        .await
        .unwrap();
        assert_eq!(values["variables"][0]["value"], "42");
        let generated = stack["frames"][1]["source"]["source_handle"]
            .as_str()
            .unwrap()
            .to_owned();
        let content = execute_operation(
            &client_output,
            &mut reader,
            5,
            "session",
            1,
            &root,
            &mut handles,
            super::super::DebugOperation::Source {
                source_handle: generated,
            },
            &record,
        )
        .await
        .unwrap();
        assert_eq!(content["content"], "generated()\n");
        handles.reset("session", 2);
        assert!(handles.thread("session", 1, "guessed").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
