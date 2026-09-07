use crate::{
    actors::{DocumentActor, LspServerActor, TerminalActor},
    models::{
        ClientId, ClientMessage, ClientParams, DocEvent, ErrorCode, FileId, LanguageId,
        ServerMessage, WorkspaceId,
    },
    state::{AppState, ClientConnectionHandle},
};
use axum::{
    extract::{
        ConnectInfo, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::IntoResponse,
};
use axum_extra::TypedHeader;
use dashmap::mapref::entry::Entry;
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::ops::ControlFlow;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use tracing::{debug, error, info};
use yrs::StateVector;
use yrs::updates::decoder::Decode;

pub async fn ws(
    Query(client): Query<ClientParams>,
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    user_agent: Option<TypedHeader<headers::UserAgent>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let user_agent = user_agent
        .map(|f| f.to_string())
        .unwrap_or("Unknown browser".into());
    info!("{user_agent} at {addr} connected.");
    ws.on_upgrade(move |socket| handle_socket(state, socket, client, addr))
}

async fn handle_socket(
    state: AppState,
    socket: WebSocket,
    client: ClientParams,
    who: SocketAddr,
) {
    // send a ping (unsupported by some browsers) just to kick things off and get a response
    // if socket
    //     .send(Message::Ping(Bytes::from_static(&[1, 2, 3])))
    //     .await
    //     .is_ok()
    // {
    //     info!("Pinged {who}");
    // } else {
    //     info!("Could not send ping to {who}!");
    //     // no Error here since the only thing we can do is to close the connection.
    //     // If we can not send messages, there is no way to salvage the statemachine anyway.
    //     return;
    // }

    // By splitting socket we can send and receive at the same time.
    let (mut sender, mut receiver) = socket.split();
    let (terminal_tx, mut terminal_rx) = mpsc::channel::<ServerMessage>(64);
    let (document_tx, mut document_rx) = mpsc::channel::<ServerMessage>(256);

    state.clients.insert(
        client.get_client_id(),
        ClientConnectionHandle::new(document_tx.clone()),
    );

    // Handle any messages that are meant to be sent. This is normally the backend
    // system communicating with the client server.
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                biased; // doc/awareness traffic wins ties over terminal spam
                Some(msg) = document_rx.recv() => {
                    if let Err(err) = sender.send(encode(msg)).await {
                        error!("Failed to send document event {:?}", err);
                    }
                }
                Some(msg) = terminal_rx.recv() => { sender.send(encode(msg)).await.ok(); }
                else => break,
            }
        }
    });

    // Handle recieving messages. This is the client sending messages to us. We
    // use concurrency to handle dealing with the messages.
    let client2 = client.clone();
    let cloned_state = state.clone();
    let mut recv_task = tokio::spawn(async move {
        let client_id = client2.get_client_id();
        while let Some(Ok(msg)) = receiver.next().await {
            if process_message(
                &msg,
                who,
                client_id.clone(),
                &cloned_state,
                document_tx.clone(),
                terminal_tx.clone(),
            )
            .await
            .is_break()
            {
                break;
            }
        }
    });

    tokio::select! {
        rv_a = (&mut send_task) => {
            match rv_a {
                Ok(_) => info!("Reciver task completed with {who}"),
                Err(a) => info!("Error sending messages {a:?}")
            }
            recv_task.abort();
        },
        rv_b = (&mut recv_task) => {
            match rv_b {
                Ok(_) => println!("Reciver task completed with {who}"),
                Err(b) => println!("Error receiving messages {b:?}")
            }
            send_task.abort();
        }
    }

    // Clean up connection
    let client_id = client.get_client_id();
    if let Some((_, client_connection_handle)) = state.clients.remove(&client_id) {
        for entry in client_connection_handle.doc_forwarders.iter() {
            entry.value().abort();
        }
        for entry in client_connection_handle.subscribed_documents.iter() {
            if let Some(document) = state.open_files.get(entry.key()).map(|e| e.value().clone()) {
                let key = entry.key().clone();
                let app_state = state.clone();
                document.unsubscribe(app_state, key).await;
            }
        }
        for entry in client_connection_handle.open_terminals.iter() {
            if let Some(terminal) = state.terminals.get(entry.key()).map(|e| e.value().clone()) {
                // disconnect ≠ explicit close: default policy here is
                // ephemeral (kill on last leave) — flip this if you want
                // tmux-like persistence across reconnects.
                if terminal.unsubscribe(&client_id) {
                    terminal.kill().await.ok();
                    state.terminals.remove(entry.key());
                }
            }
        }
    }

    info!("Websocket context {who} destroyed.")
}

fn encode(msg: ServerMessage) -> axum::extract::ws::Message {
    axum::extract::ws::Message::Text(serde_json::to_string_pretty(&msg).unwrap().into())
}

async fn dispatch(
    client_id: ClientId,
    msg: ClientMessage,
    state: &AppState,
    document_tx: mpsc::Sender<ServerMessage>,
    terminal_tx: mpsc::Sender<ServerMessage>,
) -> anyhow::Result<()> {
    match msg {
        ClientMessage::Hello => {
            document_tx
                .send(ServerMessage::Hello { client_id })
                .await
                .ok();
            Ok(())
        }

        ClientMessage::Ping => {
            document_tx.send(ServerMessage::Pong).await.ok();
            Ok(())
        }

        ClientMessage::DocSubscribe {
            workspace_id,
            file_id,
        } => {
            debug!("DocSubscribe event recieved");
            authorize(state, &client_id, &workspace_id).await?;
            debug!("User is authorized to load document");
            let doc = get_or_load_doc(state, &workspace_id, &file_id).await?;
            debug!("Document is loaded");
            doc.subscribe().await;
            debug!("Document was subscribed to.");

            // full state (sync step 2) — first time this client has seen the doc
            let full = doc.state_as_update(&StateVector::default()).await;
            document_tx
                .send(ServerMessage::DocSync {
                    workspace_id: workspace_id.clone(),
                    file_id: file_id.clone(),
                    update: full,
                })
                .await
                .ok();

            let diags = doc.latest_diagnostics().await;
            if !diags.is_empty() {
                document_tx
                    .send(ServerMessage::Diagnostics {
                        workspace_id: workspace_id.clone(),
                        file_id: file_id.clone(),
                        diagnostics: diags,
                    })
                    .await
                    .ok();
            }

            register_client_subscription(
                state,
                client_id,
                workspace_id,
                file_id,
                &doc,
                document_tx.clone(),
            );
            Ok(())
        }

        ClientMessage::DocSyncStep1 {
            workspace_id,
            file_id,
            state_vector,
        } => {
            authorize(state, &client_id, &workspace_id).await?;
            let doc = get_or_load_doc(state, &workspace_id, &file_id).await?;
            doc.subscribe().await;

            let sv = StateVector::decode_v1(&state_vector)
                .map_err(|e| anyhow::anyhow!("bad state vector: {e}"))?;
            let diff = doc.state_as_update(&sv).await;
            document_tx
                .send(ServerMessage::DocSync {
                    workspace_id: workspace_id.clone(),
                    file_id: file_id.clone(),
                    update: diff,
                })
                .await
                .ok();

            let diags = doc.latest_diagnostics().await;
            if !diags.is_empty() {
                document_tx
                    .send(ServerMessage::Diagnostics {
                        workspace_id: workspace_id.clone(),
                        file_id: file_id.clone(),
                        diagnostics: diags,
                    })
                    .await
                    .ok();
            }

            register_client_subscription(
                state,
                client_id,
                workspace_id,
                file_id,
                &doc,
                document_tx.clone(),
            );
            Ok(())
        }

        ClientMessage::DocUnsubscribe {
            workspace_id,
            file_id,
        } => {
            unsubscribe_doc(state, client_id, workspace_id, file_id).await;
            Ok(())
        }

        ClientMessage::DocUpdate {
            workspace_id,
            file_id,
            update,
        } => {
            let doc = state
                .open_files
                .get(&(workspace_id.clone(), file_id.clone()))
                .map(|e| e.value().clone())
                .ok_or_else(move || {
                    anyhow::anyhow!("doc not open: {workspace_id:?}/{file_id:?}")
                })?;
            match doc.apply_remote_update(&update, client_id).await {
                Ok(()) => Ok(()),
                Err(e) => {
                    document_tx
                        .send(ServerMessage::Error {
                            context: Some("DocUpdate".into()),
                            code: ErrorCode::ReadOnly,
                            message: e.to_string(),
                        })
                        .await
                        .ok();
                    Ok(()) // report to sender, don't kill the connection over a rejected write
                }
            }
        }

        ClientMessage::Awareness {
            workspace_id,
            file_id,
            payload,
        } => {
            if let Some(doc) = state.open_files.get(&(workspace_id, file_id)) {
                doc.value().apply_awareness(payload, client_id);
            }
            Ok(())
        }

        ClientMessage::TerminalOpen {
            workspace_id,
            term_id,
            cols,
            rows,
        } => {
            authorize(state, &client_id, &workspace_id).await?;

            if state.terminals.contains_key(&term_id) {
                anyhow::bail!("terminal {term_id} already exists");
            }

            let resolved_cwd = state.workspace_root(&workspace_id);
            let (actor, _reader_handle) =
                TerminalActor::spawn(term_id.clone(), resolved_cwd, cols, rows)?;
            actor.subscribe(client_id.clone(), terminal_tx.clone());
            state.terminals.insert(term_id.clone(), actor);

            if let Some(handle) = state.clients.get(&client_id) {
                handle.value().open_terminals.insert(term_id);
            }
            Ok(())
        }

        ClientMessage::TerminalInput { term_id, data, .. } => {
            let terminal = state
                .terminals
                .get(&term_id)
                .map(|e| e.value().clone())
                .ok_or_else(|| anyhow::anyhow!("terminal not found: {term_id}"))?;
            terminal.write_input(data).await
        }

        ClientMessage::TerminalResize {
            term_id,
            cols,
            rows,
            ..
        } => {
            let terminal = state
                .terminals
                .get(&term_id)
                .map(|e| e.value().clone())
                .ok_or_else(|| anyhow::anyhow!("terminal not found: {term_id}"))?;
            terminal.resize(cols, rows)
        }

        ClientMessage::TerminalClose { term_id, .. } => {
            if let Some(handle) = state.clients.get(&client_id) {
                handle.value().open_terminals.remove(&term_id);
            }
            // explicit close always kills, regardless of persist-on-disconnect policy
            if let Some((_, terminal)) = state.terminals.remove(&term_id) {
                terminal.kill().await.ok();
            }
            Ok(())
        }

        ClientMessage::LspRequest {
            workspace_id,
            file_id,
            request_id,
            method,
            mut params,
        } => {
            authorize(state, &client_id, &workspace_id).await?;
            let lsp = match get_or_spawn_lsp(state, &workspace_id, &file_id).await {
                Ok(lsp) => lsp,
                Err(e) => {
                    document_tx
                        .send(ServerMessage::LspError {
                            request_id,
                            message: e.to_string(),
                        })
                        .await
                        .ok();
                    return Ok(());
                }
            };
            let doc = state
                .open_files
                .get(&(workspace_id.clone(), file_id.clone()))
                .map(|e| e.value().clone());
            if let Some(doc) = &doc {
                doc.ensure_lsp_open(&lsp).await.ok();
                let uri = doc_uri(state, &workspace_id, &file_id)?;
                if let Some(obj) = params.as_object_mut() {
                    let response = serde_json::json!({ "uri": uri });
                    obj.insert("textDocument".into(), response);
                }
            }

            // fire-and-forget: the response is routed back asynchronously,
            // don't block the dispatch loop on a 10s LSP timeout.
            tokio::spawn(async move {
                match lsp.request(&method, params).await {
                    Ok(result) => {
                        document_tx
                            .send(ServerMessage::LspResponse { request_id, result })
                            .await
                            .ok();
                    }
                    Err(e) => {
                        document_tx
                            .send(ServerMessage::LspError {
                                request_id,
                                message: e.to_string(),
                            })
                            .await
                            .ok();
                    }
                }
            });
            Ok(())
        }

        ClientMessage::LspNotification {
            workspace_id,
            file_id,
            method,
            params,
        } => {
            authorize(state, &client_id, &workspace_id).await?;
            let Some(lsp) = get_lsp_if_running(state, workspace_id, file_id).await? else {
                return Ok(()); // no server yet — notifications before any request are droppable
            };
            lsp.notify(&method, params).await
        }
    }
}

/// helper to print contents of messages to stdout. Has special treatment for Close.
async fn process_message(
    msg: &Message,
    who: SocketAddr,
    client_id: ClientId,
    state: &AppState,
    document_tx: mpsc::Sender<ServerMessage>,
    terminal_tx: mpsc::Sender<ServerMessage>,
) -> ControlFlow<(), ()> {
    match msg {
        Message::Text(t) => {
            debug!(">>> {who} sent str: {t:?}");
            match serde_json::from_str::<ClientMessage>(t) {
                Ok(message) => {
                    if let Err(err) =
                        dispatch(client_id, message.clone(), state, document_tx, terminal_tx).await
                    {
                        error!(">>> {who} message {message} dispatch failed: {err}");
                    }
                }
                Err(err) => {
                    error!(">>> {who} failed to dispatch part message {:?}", err);
                }
            }
        }
        Message::Binary(d) => {
            debug!(">>> {who} sent {} bytes", d.len());
            if let Ok(message) = serde_json::from_slice::<ClientMessage>(d) {
                if let Err(err) =
                    dispatch(client_id, message.clone(), state, document_tx, terminal_tx).await
                {
                    error!(">>> {who} message {message} dispatch failed: {err}");
                }
            }
        }
        Message::Close(c) => {
            if let Some(cf) = c {
                info!(
                    ">>> {who} sent close with code {} and reason `{}`",
                    cf.code, cf.reason
                );
            }
            return ControlFlow::Break(());
        }
        Message::Pong(v) => debug!(">>> {who} sent pong with {v:?}"),
        Message::Ping(v) => debug!(">>> {who} sent ping with {v:?}"),
    }
    ControlFlow::Continue(())
}

/*
TO REVIEW:
AI generated code
*/

async fn authorize(
    state: &AppState,
    client_id: &ClientId,
    workspace_id: &WorkspaceId,
) -> anyhow::Result<()> {
    if let Some(handle) = state.clients.get(client_id) {
        if handle.value().authorized_workspaces.contains(workspace_id) {
            return Ok(());
        }
    }
    state.authorize(client_id, workspace_id)?;
    if let Some(handle) = state.clients.get(client_id) {
        handle
            .value()
            .authorized_workspaces
            .insert(workspace_id.clone());
    }
    Ok(())
}

async fn get_or_load_doc(
    state: &AppState,
    workspace_id: &WorkspaceId,
    file_id: &FileId,
) -> anyhow::Result<Arc<DocumentActor>> {
    let key = (workspace_id.clone(), file_id.clone());
    if let Some(existing) = state.open_files.get(&key) {
        debug!("File {} {} already open", workspace_id, file_id);
        return Ok(existing.value().clone());
    }

    // resolve + load happens outside any DashMap guard (it's async and can
    // be slow — reading a file — so never do this while holding a shard lock)
    let path = state.resolve_file_path(workspace_id, file_id)?;
    debug!("Openning file {:?}", path);
    let doc = DocumentActor::load(workspace_id, file_id, path).await?;

    // race: two clients could both miss the cache and both load. Use entry
    // API to make the insert atomic and discard the loser.
    match state.open_files.entry(key) {
        Entry::Occupied(e) => Ok(e.get().clone()),
        Entry::Vacant(e) => Ok(e.insert(doc).clone()),
    }
}

/// Spawns a task forwarding this doc's broadcast events to one client's
/// sender, and records the task so it can be aborted on unsubscribe/disconnect.
fn register_client_subscription(
    state: &AppState,
    client_id: ClientId,
    workspace_id: WorkspaceId,
    file_id: FileId,
    doc: &Arc<DocumentActor>,
    document_tx: mpsc::Sender<ServerMessage>,
) {
    let Some(client_handle) = state.clients.get(&client_id) else {
        return;
    };
    let key = (workspace_id.clone(), file_id.clone());
    let handle = client_handle.value();

    if handle.subscribed_documents.contains(&key) {
        return; // already subscribed — e.g. duplicate DocSubscribe from a retry
    }
    handle.subscribed_documents.insert(key.clone());

    let mut rx = doc.subscribe_events();
    let workspace_id_cloned = workspace_id.clone();
    let file_id_cloned = file_id.clone();
    let forwarder = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(DocEvent::Update { update, origin }) => {
                    document_tx
                        .send(ServerMessage::DocUpdate {
                            workspace_id: workspace_id_cloned.clone(),
                            file_id: file_id_cloned.clone(),
                            update,
                            origin,
                        })
                        .await
                        .ok();
                }
                Ok(DocEvent::Awareness { payload, origin }) => {
                    document_tx
                        .send(ServerMessage::Awareness {
                            workspace_id: workspace_id_cloned.clone(),
                            file_id: file_id_cloned.clone(),
                            client_id: origin,
                            payload,
                        })
                        .await
                        .ok();
                }
                Ok(DocEvent::Diagnostics { diagnostics }) => {
                    document_tx
                        .send(ServerMessage::Diagnostics {
                            workspace_id: workspace_id_cloned.clone(),
                            file_id: file_id_cloned.clone(),
                            diagnostics,
                        })
                        .await
                        .ok();
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("client lagged {n} doc events on {file_id:?}, continuing");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    handle.doc_forwarders.insert(key, forwarder);
}

async fn unsubscribe_doc(
    state: &AppState,
    client_id: ClientId,
    workspace_id: WorkspaceId,
    file_id: FileId,
) {
    let key = (workspace_id.clone(), file_id.clone());
    if let Some(client_handle) = state.clients.get(&client_id) {
        let handle = client_handle.value();
        handle.subscribed_documents.remove(&key);
        if let Some((_, task)) = handle.doc_forwarders.remove(&key) {
            task.abort();
        }
    }

    if let Some(doc) = state.open_files.get(&key).map(|e| e.value().clone()) {
        doc.unsubscribe(state.clone(), key).await;
    }
}

async fn get_or_spawn_lsp(
    state: &AppState,
    workspace_id: &WorkspaceId,
    file_id: &FileId,
) -> anyhow::Result<Arc<LspServerActor>> {
    let path = state.resolve_file_path(workspace_id, file_id)?;
    let language = LanguageId::from_path(&path)
        .await
        .ok_or_else(|| anyhow::anyhow!("no LSP configured for {path:?}"))?;

    let key = (workspace_id.clone(), language);
    if let Some(existing) = state.lsp_servers.get(&key) {
        return Ok(existing.value().clone());
    }

    let root = state.workspace_root(workspace_id);
    let actor = LspServerActor::spawn(
        Arc::new(state.clone()),
        &root,
        workspace_id.clone(),
        language,
    )
    .await?;

    match state.lsp_servers.entry(key) {
        Entry::Occupied(e) => Ok(e.get().clone()), // another request won the race
        Entry::Vacant(e) => Ok(e.insert(actor).clone()),
    }
}

async fn get_lsp_if_running(
    state: &AppState,
    workspace_id: WorkspaceId,
    file_id: FileId,
) -> anyhow::Result<Option<Arc<LspServerActor>>> {
    let path = state.resolve_file_path(&workspace_id, &file_id)?;
    let language = LanguageId::from_path(&path).await.ok_or(anyhow::Error::msg("Failed to get language result".to_string()))?;
    Ok(state
        .lsp_servers
        .get(&(workspace_id, language))
        .map(|e| e.value().clone()))
}

fn doc_uri(state: &AppState, workspace_id: &WorkspaceId, file_id: &FileId) -> anyhow::Result<String> {
    Ok(format!(
        "file://{}",
        state.resolve_file_path(workspace_id, file_id)?.display()
    ))
}
