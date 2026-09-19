use crate::{
    config::DebugAdapterConfig,
    debug::{
        AdapterCommand, AdapterTransport, DebugStrategy, Event, InitializeArguments,
        LaunchArguments, OutputChunk, ResolvedConfiguration, SessionSnapshot, SessionState, dap,
    },
    models::WorkspaceId,
};
use std::{path::Path, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    net::{TcpListener, TcpStream},
    process::{Child, ChildStderr, Command},
    sync::{Mutex, watch},
};

const MAX_OUTPUT_BYTES: usize = 256 * 1024;

/// Owns the process and DAP protocol lifecycle for one debug session.
#[derive(Debug)]
pub struct DebugSessionActor {
    workspace_id: WorkspaceId,
    session_id: String,
    record: Mutex<Record>,
    updates: watch::Sender<SessionSnapshot>,
}

#[derive(Debug)]
struct Record {
    snapshot: SessionSnapshot,
    child: Option<Child>,
    stop: bool,
    output_bytes: usize,
}

impl Record {
    fn transition(&mut self, state: SessionState) {
        self.snapshot.state = state;
        self.snapshot.event_cursor += 1;
    }

    fn append_output(&mut self, category: &str, mut text: String) {
        if text.len() > 64 * 1024 {
            text.truncate(64 * 1024);
            text.push_str("\n[output truncated]");
        }
        while self.output_bytes + text.len() > MAX_OUTPUT_BYTES {
            if let Some(old) = self.snapshot.output.first() {
                self.output_bytes = self.output_bytes.saturating_sub(old.output.len());
                self.snapshot.output.remove(0);
            } else {
                break;
            }
        }
        self.output_bytes += text.len();
        self.snapshot.event_cursor += 1;
        self.snapshot.output.push(OutputChunk {
            sequence: self.snapshot.event_cursor,
            category: category.into(),
            output: text,
        });
    }
}

impl DebugSessionActor {
    pub fn spawn(
        snapshot: SessionSnapshot,
        configuration: ResolvedConfiguration,
        strategy: Box<dyn DebugStrategy>,
        adapter: DebugAdapterConfig,
    ) -> Arc<Self> {
        let (updates, _) = watch::channel(snapshot.clone());
        let actor = Arc::new(Self {
            workspace_id: snapshot.workspace_id.clone(),
            session_id: snapshot.session_id.clone(),
            record: Mutex::new(Record {
                snapshot,
                child: None,
                stop: false,
                output_bytes: 0,
            }),
            updates,
        });
        tokio::spawn(Self::run(actor.clone(), configuration, strategy, adapter));
        actor
    }

    pub fn workspace_id(&self) -> &WorkspaceId {
        &self.workspace_id
    }

    pub async fn is_active(&self) -> bool {
        !matches!(
            self.record.lock().await.snapshot.state,
            SessionState::Terminated | SessionState::Failed
        )
    }

    pub async fn snapshot(&self, workspace: &WorkspaceId) -> anyhow::Result<SessionSnapshot> {
        if self.workspace_id != *workspace {
            anyhow::bail!("debug session not found")
        }
        Ok(self.record.lock().await.snapshot.clone())
    }

    pub fn subscribe(
        &self,
        workspace: &WorkspaceId,
    ) -> anyhow::Result<watch::Receiver<SessionSnapshot>> {
        if self.workspace_id != *workspace {
            anyhow::bail!("debug session not found")
        }
        Ok(self.updates.subscribe())
    }

    pub async fn stop(&self, workspace: &WorkspaceId) -> anyhow::Result<SessionSnapshot> {
        if self.workspace_id != *workspace {
            anyhow::bail!("debug session not found")
        }
        let mut record = self.record.lock().await;
        if !matches!(
            record.snapshot.state,
            SessionState::Terminated | SessionState::Failed
        ) {
            record.stop = true;
            record.transition(SessionState::Terminating);
            if let Some(child) = record.child.as_mut() {
                let _ = child.start_kill();
            }
            self.publish(&record);
        }
        Ok(record.snapshot.clone())
    }

    async fn run(
        actor: Arc<Self>,
        configuration: ResolvedConfiguration,
        strategy: Box<dyn DebugStrategy>,
        adapter: DebugAdapterConfig,
    ) {
        let debug_output = strategy.debug_output_path(&actor.session_id);
        if let Some(path) = debug_output.as_deref()
            && let Err(error) = Self::prepare_debug_output(path).await
        {
            actor
                .fail(&format!(
                    "The debug build artifact could not be prepared: {error}"
                ))
                .await;
            return;
        }
        Self::run_session(
            actor.clone(),
            configuration,
            strategy,
            adapter,
            debug_output.as_deref(),
        )
        .await;
        if let Some(path) = debug_output {
            Self::remove_debug_output(&path).await;
        }
    }

    async fn run_session(
        actor: Arc<Self>,
        configuration: ResolvedConfiguration,
        strategy: Box<dyn DebugStrategy>,
        adapter: DebugAdapterConfig,
        debug_output: Option<&Path>,
    ) {
        actor.transition(SessionState::SpawningAdapter).await;

        let adapter_command = strategy.command();
        let (child, input, output, stderr) =
            match Self::spawn_adapter(&adapter_command, &configuration.cwd, &adapter).await {
                Ok(connection) => connection,
                Err(error) => {
                    actor
                        .fail(&format!(
                            "{} is unavailable: {error}",
                            strategy.display_name()
                        ))
                        .await;
                    return;
                }
            };
        actor.attach(child).await;
        if let Some(stderr) = stderr {
            tokio::spawn(Self::drain_stderr(actor.clone(), stderr));
        }

        let mut client = dap::DapClient::new(output, input);
        if !actor
            .initialize(&mut client, &adapter_command.adapter_id)
            .await
        {
            return;
        }
        if !actor
            .launch(
                &mut client,
                strategy.launch_arguments(&configuration, debug_output),
            )
            .await
        {
            return;
        }

        actor.transition(SessionState::Running).await;
        actor.receive_events(&mut client).await;
        actor.finish().await;
    }

    async fn initialize<R, W>(&self, client: &mut dap::DapClient<R, W>, adapter_id: &str) -> bool
    where
        R: tokio::io::AsyncRead + Unpin,
        W: tokio::io::AsyncWrite + Unpin,
    {
        if let Err(error) = client
            .initialize(InitializeArguments::forge(adapter_id))
            .await
        {
            self.fail(&format!("Debug adapter initialization failed: {error}"))
                .await;
            return false;
        }
        true
    }

    async fn launch<R, W>(
        &self,
        client: &mut dap::DapClient<R, W>,
        arguments: LaunchArguments,
    ) -> bool
    where
        R: tokio::io::AsyncRead + Unpin,
        W: tokio::io::AsyncWrite + Unpin,
    {
        self.transition(SessionState::Launching).await;
        self.transition(SessionState::Configuring).await;
        if let Err(error) = client.launch_and_configure(arguments).await {
            self.fail(&format!("The debug target could not be launched: {error}"))
                .await;
            return false;
        }
        true
    }

    async fn receive_events<R, W>(&self, client: &mut dap::DapClient<R, W>)
    where
        R: tokio::io::AsyncRead + Unpin,
        W: tokio::io::AsyncWrite + Unpin,
    {
        loop {
            if self.stop_requested().await {
                let _ = client.disconnect(true).await;
                return;
            }
            match tokio::time::timeout(Duration::from_millis(200), client.next_event()).await {
                Ok(Ok(Some(event))) => self.handle_event(event).await,
                Ok(Ok(None)) => return,
                Ok(Err(_)) => {
                    self.fail("The debug adapter sent an invalid message.")
                        .await;
                    return;
                }
                Err(_) => continue,
            }
            if !self.is_active().await {
                return;
            }
        }
    }

    async fn handle_event(&self, event: Event) {
        let mut record = self.record.lock().await;
        match event {
            Event::Output { category, output } => record.append_output(&category, output),
            Event::Exited { exit_code } => {
                record.snapshot.exit_code = exit_code;
                record.snapshot.event_cursor += 1;
            }
            Event::Terminated => record.transition(SessionState::Terminated),
            _ => {}
        }
        self.publish(&record);
    }

    async fn transition(&self, state: SessionState) {
        let mut record = self.record.lock().await;
        record.transition(state);
        self.publish(&record);
    }

    async fn attach(&self, child: Child) {
        let mut record = self.record.lock().await;
        record.child = Some(child);
        record.transition(SessionState::Initializing);
        self.publish(&record);
    }

    async fn stop_requested(&self) -> bool {
        self.record.lock().await.stop
    }

    async fn finish(&self) {
        let mut record = self.record.lock().await;
        if let Some(child) = record.child.as_mut() {
            let _ = child.start_kill();
        }
        if !matches!(record.snapshot.state, SessionState::Failed) {
            record.transition(SessionState::Terminated);
        }
        self.publish(&record);
    }

    async fn fail(&self, message: &str) {
        let mut record = self.record.lock().await;
        record.snapshot.error = Some(message.into());
        if let Some(child) = record.child.as_mut() {
            let _ = child.start_kill();
        }
        record.transition(SessionState::Failed);
        self.publish(&record);
    }

    async fn drain_stderr(actor: Arc<Self>, mut stderr: ChildStderr) {
        use tokio::io::AsyncReadExt;

        let mut buffer = vec![0; 8192];
        while let Ok(count) = stderr.read(&mut buffer).await {
            if count == 0 {
                return;
            }
            let text = String::from_utf8_lossy(&buffer[..count]).replace('\r', "");
            let mut record = actor.record.lock().await;
            record.append_output("adapter", text);
            actor.publish(&record);
        }
    }

    fn publish(&self, record: &Record) {
        self.updates.send_replace(record.snapshot.clone());
    }

    async fn prepare_debug_output(path: &Path) -> anyhow::Result<()> {
        let parent = path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("debug build artifact has no parent directory"))?;
        tokio::fs::create_dir_all(parent).await?;
        Ok(())
    }

    async fn remove_debug_output(path: &Path) {
        match tokio::fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "could not remove debug build artifact")
            }
        }
    }

    async fn spawn_adapter(
        adapter: &AdapterCommand,
        cwd: &std::path::Path,
        config: &DebugAdapterConfig,
    ) -> anyhow::Result<(Child, DapOutput, DapInput, Option<ChildStderr>)> {
        match &adapter.transport {
            AdapterTransport::Stdio => {
                let mut command = Self::adapter_process(adapter, cwd, config);
                command.stdin(Stdio::piped()).stdout(Stdio::piped());
                let mut child = command.spawn()?;
                let input = child
                    .stdin
                    .take()
                    .ok_or_else(|| anyhow::anyhow!("adapter stdin was not available"))?;
                let output = child
                    .stdout
                    .take()
                    .ok_or_else(|| anyhow::anyhow!("adapter stdout was not available"))?;
                let stderr = child.stderr.take();
                Ok((child, Box::new(input), Box::new(output), stderr))
            }
            AdapterTransport::Loopback { arguments } => {
                let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
                let address = listener.local_addr()?;
                drop(listener);
                let port = address.port().to_string();
                let mut command = Self::adapter_process(adapter, cwd, config);
                command.args(
                    arguments
                        .iter()
                        .map(|argument| argument.replace("{port}", &port)),
                );
                let mut child = command.spawn()?;
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
                let (output, input) = stream.into_split();
                let stderr = child.stderr.take();
                Ok((child, Box::new(input), Box::new(output), stderr))
            }
        }
    }

    fn adapter_process(
        adapter: &AdapterCommand,
        cwd: &std::path::Path,
        config: &DebugAdapterConfig,
    ) -> Command {
        let mut command = Command::new(&adapter.executable);
        command
            .args(&adapter.arguments)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .env_clear()
            .env("PATH", &config.path)
            .kill_on_drop(true);
        if let Some(home) = &config.home {
            command.env("HOME", home);
        }
        command
    }
}

type DapInput = Box<dyn tokio::io::AsyncRead + Unpin + Send>;
type DapOutput = Box<dyn tokio::io::AsyncWrite + Unpin + Send>;
