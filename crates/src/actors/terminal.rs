// src/terminal.rs
use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
};

use bytes::Bytes;
use dashmap::DashMap;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::{sync::mpsc, task::JoinHandle};
use tracing::{info, warn};

use crate::models::{
    ClientId, ServerMessage, TerminalExit, TerminalId, TerminalStatus, WorkspaceId,
};

pub struct TerminalActor {
    terminal_id: TerminalId,
    workspace_id: WorkspaceId,
    title: Arc<std::sync::RwLock<String>>,
    pty_writer: Arc<StdMutex<Box<dyn Write + Send>>>,
    master: StdMutex<Box<dyn MasterPty + Send>>,
    child: tokio::sync::Mutex<Box<dyn Child + Send + Sync>>,
    subscribers: DashMap<ClientId, mpsc::Sender<ServerMessage>>,
}

impl std::fmt::Debug for TerminalActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TerminalActor")
            .field("terminal_id", &self.terminal_id)
            .field("subscribers", &self.subscribers.len())
            .finish()
    }
}

fn default_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
    #[cfg(windows)]
    {
        "cmd.exe".to_string()
    }
}

impl TerminalActor {
    pub fn spawn(
        terminal_id: TerminalId,
        workspace_id: WorkspaceId,
        title: Arc<std::sync::RwLock<String>>,
        cwd: PathBuf,
        cols: u16,
        rows: u16,
    ) -> anyhow::Result<(Arc<Self>, JoinHandle<()>, tokio::sync::oneshot::Sender<()>)> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(default_shell());
        cmd.cwd(cwd);
        cmd.env_clear();
        for name in ["HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL"] {
            if let Some(value) = std::env::var_os(name) {
                cmd.env(name, value);
            }
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave); // slave fd isn't needed once the child holds it

        let writer = pair.master.take_writer()?;
        let reader = pair.master.try_clone_reader()?;

        let actor = Arc::new(Self {
            terminal_id,
            workspace_id,
            title,
            pty_writer: Arc::new(StdMutex::new(writer)),
            master: StdMutex::new(pair.master),
            child: tokio::sync::Mutex::new(child),
            subscribers: DashMap::new(),
        });

        let actor_for_reader = actor.clone();
        let (start_tx, start_rx) = tokio::sync::oneshot::channel();
        let handle = tokio::task::spawn_blocking(move || {
            if start_rx.blocking_recv().is_err() {
                return;
            }
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => actor_for_reader.broadcast(ServerMessage::TerminalOutput {
                        workspace_id: actor_for_reader.workspace_id.clone(),
                        terminal_id: actor_for_reader.terminal_id.clone(),
                        data: Bytes::copy_from_slice(&buf[..n]).to_vec(),
                    }),
                    Err(e) => {
                        warn!("terminal {} read error: {e}", actor_for_reader.terminal_id);
                        break;
                    }
                }
            }

            // spawn_blocking runs on a blocking thread, so blocking_lock() is
            // correct here (regular .lock().await isn't available off the
            // async runtime).
            let code = actor_for_reader
                .child
                .blocking_lock()
                .wait()
                .ok()
                .map(|status| status.exit_code() as i32);

            actor_for_reader.broadcast(ServerMessage::TerminalState {
                workspace_id: actor_for_reader.workspace_id.clone(),
                terminal_id: actor_for_reader.terminal_id.clone(),
                status: TerminalStatus::Exited,
                title: actor_for_reader.title.read().unwrap().clone(),
                exit: Some(TerminalExit { code, signal: None }),
            });
        });

        Ok((actor, handle, start_tx))
    }

    pub fn subscribe(&self, client: ClientId, sender: mpsc::Sender<ServerMessage>) {
        self.subscribers.insert(client, sender);
    }

    pub async fn write_input(&self, data: Vec<u8>) -> anyhow::Result<()> {
        let writer = self.pty_writer.clone();
        tokio::task::spawn_blocking(move || {
            let mut w = writer.lock().unwrap();
            w.write_all(&data)?;
            w.flush()
        })
        .await??;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> anyhow::Result<()> {
        self.master.lock().unwrap().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    fn broadcast(&self, msg: ServerMessage) {
        // prune subscribers whose receiver has actually disconnected;
        // leave ones that are merely full (drop this message for them,
        // don't punish the whole workspace for one slow client)
        self.subscribers
            .retain(|_, sender| match sender.try_send(msg.clone()) {
                Ok(()) => true,
                Err(mpsc::error::TrySendError::Full(_)) => true,
                Err(mpsc::error::TrySendError::Closed(_)) => false,
            });
    }

    /// Returns true if no subscribers remain — caller decides whether that
    /// means "kill the process" (ephemeral) or "leave it running" (tmux-like
    /// persistence), and whether to remove the actor from AppState.
    pub fn unsubscribe(&self, client: &ClientId) -> bool {
        self.subscribers.remove(client);
        let empty = self.subscribers.is_empty();
        if empty {
            info!("terminal {} has no subscribers", self.terminal_id);
        }
        empty
    }

    pub async fn kill(&self) -> anyhow::Result<()> {
        self.child.lock().await.kill()?;
        Ok(())
    }
}
