use super::{
    AdapterCommand, AdapterTransport, ConfigurationList, CreateSession, DebugStrategy, OutputChunk,
    ResolvedConfiguration, SessionSnapshot, SessionState, StrategyRegistry, config, dap,
};
use dashmap::DashMap;
use serde_json::json;
use std::{process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::{TcpListener, TcpStream},
    process::{Child, Command},
    sync::Mutex,
};
use uuid::Uuid;

const MAX_OUTPUT_BYTES: usize = 256 * 1024;

#[derive(Debug)]
struct Record {
    snapshot: SessionSnapshot,
    child: Option<Child>,
    stop: bool,
    output_bytes: usize,
}

#[derive(Debug, Clone)]
pub struct DebugService {
    sessions: Arc<DashMap<String, Arc<Mutex<Record>>>>,
    strategies: StrategyRegistry,
}

impl DebugService {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            strategies: StrategyRegistry::default(),
        }
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
        };
        let record = Arc::new(Mutex::new(Record {
            snapshot: snapshot.clone(),
            child: None,
            stop: false,
            output_bytes: 0,
        }));
        self.sessions.insert(id, record.clone());
        tokio::spawn(run(record, configuration, strategy));
        Ok(snapshot)
    }
    pub async fn get(&self, workspace: &str, session: &str) -> anyhow::Result<SessionSnapshot> {
        let record = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug session not found"))?
            .clone();
        let guard = record.lock().await;
        if guard.snapshot.workspace_id != workspace {
            anyhow::bail!("debug session not found")
        }
        Ok(guard.snapshot.clone())
    }
    pub async fn stop(&self, workspace: &str, session: &str) -> anyhow::Result<SessionSnapshot> {
        let record = self
            .sessions
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("debug session not found"))?
            .clone();
        let mut r = record.lock().await;
        if r.snapshot.workspace_id != workspace {
            anyhow::bail!("debug session not found")
        }
        if !matches!(
            r.snapshot.state,
            SessionState::Terminated | SessionState::Failed
        ) {
            r.stop = true;
            transition(&mut r, SessionState::Terminating);
            if let Some(child) = r.child.as_mut() {
                let _ = child.start_kill();
            }
        }
        Ok(r.snapshot.clone())
    }
}

fn transition(r: &mut Record, state: SessionState) {
    r.snapshot.state = state;
    r.snapshot.event_cursor += 1;
}
fn output(r: &mut Record, category: &str, mut text: String) {
    if text.len() > 64 * 1024 {
        text.truncate(64 * 1024);
        text.push_str("\n[output truncated]");
    }
    while r.output_bytes + text.len() > MAX_OUTPUT_BYTES {
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
}

type DapInput = Box<dyn AsyncRead + Unpin + Send>;
type DapOutput = Box<dyn AsyncWrite + Unpin + Send>;

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
            Ok((child, Box::new(stdin), Box::new(stdout), stderr))
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
            Ok((child, Box::new(write), Box::new(read), stderr))
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
        .env(
            "PATH",
            "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/llvm/bin:/usr/local/opt/llvm/bin",
        )
        .kill_on_drop(true);
    command
}

async fn run(
    record: Arc<Mutex<Record>>,
    config: ResolvedConfiguration,
    strategy: Arc<dyn DebugStrategy>,
) {
    {
        let mut r = record.lock().await;
        transition(&mut r, SessionState::SpawningAdapter);
    }
    let adapter = strategy.command();
    let (child, mut stdin, stdout, stderr) = match spawn_adapter(&adapter, &config.cwd).await {
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
        r.child = Some(child);
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
    if dap::write_message(&mut stdin,&dap::request(1,"initialize",json!({"clientID":"forge","clientName":"Forge","adapterID":adapter.adapter_id,"pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsRunInTerminalRequest":false}))).await.is_err() { fail(&record,"Debug adapter initialization failed.").await; return }
    let mut reader = dap::Reader::new(stdout);
    let initialized = wait_response(&mut reader, 1, &record).await;
    if !initialized {
        fail(&record, "Debug adapter did not initialize.").await;
        return;
    }
    {
        let mut r = record.lock().await;
        transition(&mut r, SessionState::Launching);
    }
    let launch = strategy.launch_arguments(&config);
    if dap::write_message(&mut stdin, &dap::request(2, "launch", launch))
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
    // LLDB may hold the launch response until configurationDone, while other
    // adapters respond first. Sending it immediately is valid because phase 1
    // has no breakpoint requests and avoids deadlocking either ordering.
    if dap::write_message(&mut stdin, &dap::request(3, "configurationDone", json!({})))
        .await
        .is_err()
        || !wait_response(&mut reader, 2, &record).await
    {
        fail(&record, "The debug target could not be launched.").await;
        return;
    }
    {
        let mut r = record.lock().await;
        transition(&mut r, SessionState::Running);
    }
    loop {
        if record.lock().await.stop {
            let _ = dap::write_message(
                &mut stdin,
                &dap::request(4, "disconnect", json!({"terminateDebuggee":true})),
            )
            .await;
            break;
        }
        match tokio::time::timeout(Duration::from_millis(200), reader.next()).await {
            Ok(Ok(Some(message))) => handle_message(&record, message).await,
            Ok(Ok(None)) => break,
            Ok(Err(_)) => {
                fail(&record, "The debug adapter sent an invalid message.").await;
                return;
            }
            Err(_) => continue,
        }
        if matches!(
            record.lock().await.snapshot.state,
            SessionState::Terminated | SessionState::Failed
        ) {
            break;
        }
    }
    let mut r = record.lock().await;
    if let Some(child) = r.child.as_mut() {
        let _ = child.start_kill();
    }
    if !matches!(r.snapshot.state, SessionState::Failed) {
        transition(&mut r, SessionState::Terminated);
    }
}
async fn wait_response<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut dap::Reader<R>,
    seq: u64,
    record: &Arc<Mutex<Record>>,
) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(1), reader.next()).await {
            Ok(Ok(Some(v))) if v["type"] == "response" && v["request_seq"] == seq => {
                return v["success"].as_bool().unwrap_or(false);
            }
            Ok(Ok(Some(v))) => handle_message(record, v).await,
            Ok(Ok(None)) | Ok(Err(_)) => return false,
            Err(_) => {}
        }
    }
    false
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
        _ => {}
    }
}
async fn fail(record: &Arc<Mutex<Record>>, message: &str) {
    let mut r = record.lock().await;
    r.snapshot.error = Some(message.into());
    if let Some(child) = r.child.as_mut() {
        let _ = child.start_kill();
    }
    transition(&mut r, SessionState::Failed);
}
