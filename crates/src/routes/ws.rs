use crate::{
    actors::{DocumentActor, LspServerActor, TerminalActor},
    models::{
        ClientId, ClientMessage, ClientParams, DocEvent, ErrorCode, FileId, LanguageId,
        ServerMessage, WorkspaceId,
    },
    services::workspace_mutations,
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
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tracing::{debug, error, info, warn};
use yrs::StateVector;
use yrs::updates::{decoder::Decode, encoder::Encode};

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

async fn handle_socket(state: AppState, socket: WebSocket, client: ClientParams, who: SocketAddr) {
    // By splitting socket we can send and receive at the same time.
    let (mut sender, mut receiver) = socket.split();
    let (terminal_tx, mut terminal_rx) = mpsc::channel::<ServerMessage>(64);
    let (document_tx, mut document_rx) = mpsc::channel::<ServerMessage>(256);

    let client_id = client.get_client_id();
    let replacement = state.new_client_connection(document_tx.clone());
    let connection_id = replacement.connection_id;
    if let Some(superseded) = state.clients.insert(client_id.clone(), replacement) {
        // A reconnect can arrive before the old socket finishes its close
        // path. Release the old connection's forwarders/refcounts now; its
        // eventual cleanup is identity-checked and cannot touch the new one.
        cleanup_connection_resources(&state, &client_id, superseded).await;
    }

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
                connection_id,
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
    if let Some((_, client_connection_handle)) = state.clients.remove_if(&client_id, |_, handle| {
        handle.connection_id == connection_id
    }) {
        cleanup_connection_resources(&state, &client_id, client_connection_handle).await;
    }

    info!("Websocket context {who} destroyed.")
}

fn encode(msg: ServerMessage) -> axum::extract::ws::Message {
    axum::extract::ws::Message::Text(serde_json::to_string_pretty(&msg).unwrap().into())
}

async fn dispatch(
    connection_id: u64,
    client_id: ClientId,
    msg: ClientMessage,
    state: &AppState,
    document_tx: mpsc::Sender<ServerMessage>,
    terminal_tx: mpsc::Sender<ServerMessage>,
) -> anyhow::Result<()> {
    if !is_current_connection(state, &client_id, connection_id) {
        anyhow::bail!("websocket connection superseded");
    }
    match msg {
        ClientMessage::Hello => {
            document_tx
                .send(ServerMessage::Hello {
                    client_id,
                    environment_id: state.config.environment.id.clone(),
                    schema_version: 1,
                })
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
            authorize(state, &client_id, &workspace_id).await?;
            let doc =
                workspace_mutations::get_or_load_document(state, &workspace_id, &file_id).await?;

            let first_subscription = register_client_subscription(
                state,
                client_id.clone(),
                connection_id,
                workspace_id.clone(),
                file_id.clone(),
                &doc,
                document_tx.clone(),
            );
            if first_subscription {
                doc.subscribe().await;
            }

            if let Some(lsp) = get_or_spawn_lsp(state, &workspace_id, &file_id).await? {
                doc.ensure_lsp_open(&lsp).await?;
            }

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
            send_doc_state(&document_tx, &workspace_id, &file_id, &doc).await;

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

            Ok(())
        }

        ClientMessage::DocSyncStep1 {
            workspace_id,
            file_id,
            state_vector,
        } => {
            authorize(state, &client_id, &workspace_id).await?;
            // Validate the client's vector before touching subscription
            // bookkeeping; malformed reconnect input must not leak a refcount.
            let sv = StateVector::decode_v1(&state_vector)
                .map_err(|e| anyhow::anyhow!("bad state vector: {e}"))?;
            let doc =
                workspace_mutations::get_or_load_document(state, &workspace_id, &file_id).await?;

            if let Some(lsp) = get_or_spawn_lsp(state, &workspace_id, &file_id).await? {
                doc.ensure_lsp_open(&lsp).await?;
            }

            let first_subscription = register_client_subscription(
                state,
                client_id.clone(),
                connection_id,
                workspace_id.clone(),
                file_id.clone(),
                &doc,
                document_tx.clone(),
            );
            if first_subscription {
                doc.subscribe().await;
            }

            let diff = doc.state_as_update(&sv).await;
            send_doc_sync_step2(&document_tx, &workspace_id, &file_id, &doc, diff).await;
            send_doc_state(&document_tx, &workspace_id, &file_id, &doc).await;

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

            Ok(())
        }

        // Reconnect state exchange is intentionally staged separately. Keep
        // this message non-fatal so newer clients can connect during rollout.
        ClientMessage::DocSyncStep2 {
            workspace_id,
            file_id,
            update,
        } => {
            authorize(state, &client_id, &workspace_id).await?;
            let doc =
                workspace_mutations::get_or_load_document(state, &workspace_id, &file_id).await?;
            let first_subscription = register_client_subscription(
                state,
                client_id.clone(),
                connection_id,
                workspace_id.clone(),
                file_id.clone(),
                &doc,
                document_tx.clone(),
            );
            if first_subscription {
                doc.subscribe().await;
            }
            if !update.is_empty() {
                if let Err(error) = doc.apply_remote_update(&update, client_id).await {
                    document_tx
                        .send(ServerMessage::Error {
                            context: Some("DocSyncStep2".into()),
                            code: ErrorCode::ReadOnly,
                            message: error.to_string(),
                        })
                        .await
                        .ok();
                }
            }
            // Even an empty delta is meaningful: it confirms the current
            // lifecycle state after the client has completed its handshake.
            send_doc_state(&document_tx, &workspace_id, &file_id, &doc).await;
            Ok(())
        }

        ClientMessage::DocSave {
            workspace_id,
            file_id,
            request_id,
        } => {
            info!(
                workspace_id = %workspace_id,
                file_id = %file_id,
                request_id = %request_id,
                connection_id,
                "document save requested"
            );
            // Save errors are document-level failures, not protocol failures:
            // always correlate them to the caller so one failed write cannot
            // tear down the websocket or strand a client promise.
            if let Err(error) = authorize(state, &client_id, &workspace_id).await {
                warn!(
                    workspace_id = %workspace_id,
                    file_id = %file_id,
                    request_id = %request_id,
                    connection_id,
                    error = %error,
                    "document save rejected: authorization failed"
                );
                send_save_result(
                    &document_tx,
                    workspace_id,
                    file_id,
                    request_id,
                    0,
                    0,
                    Some(error.to_string()),
                )
                .await;
                return Ok(());
            }

            let key = (workspace_id.clone(), file_id.clone());
            let Some(doc) = state
                .open_files
                .get(&key)
                .map(|entry| entry.value().clone())
            else {
                warn!(
                    workspace_id = %workspace_id,
                    file_id = %file_id,
                    request_id = %request_id,
                    connection_id,
                    "document save rejected: document is not open"
                );
                send_save_result(
                    &document_tx,
                    workspace_id,
                    file_id,
                    request_id,
                    0,
                    0,
                    Some("document is not open".into()),
                )
                .await;
                return Ok(());
            };

            match doc.save().await {
                Ok(result) => {
                    send_save_result(
                        &document_tx,
                        workspace_id.clone(),
                        file_id.clone(),
                        request_id,
                        result.saved_revision,
                        result.current_revision,
                        None,
                    )
                    .await;
                    info!(
                        workspace_id = %workspace_id,
                        file_id = %file_id,
                        request_id = %request_id,
                        connection_id,
                        saved_revision = result.saved_revision,
                        current_revision = result.current_revision,
                        "document save acknowledged"
                    );

                    // didSave is advisory and must not turn a successful disk
                    // write into a failed save acknowledgement.
                    match get_lsp_if_running(state, workspace_id, file_id).await {
                        Ok(Some(lsp)) => {
                            if let Err(error) = doc.notify_lsp_did_save(&lsp).await {
                                warn!("failed to send didSave notification: {error}");
                            }
                        }
                        Ok(None) => {}
                        Err(error) => warn!("failed to find LSP for saved document: {error}"),
                    }
                }
                Err(error) => {
                    let lifecycle = doc.lifecycle_snapshot().await;
                    warn!(
                        workspace_id = %workspace_id,
                        file_id = %file_id,
                        request_id = %request_id,
                        connection_id,
                        revision = lifecycle.revision,
                        persisted_revision = lifecycle.persisted_revision,
                        error = %error,
                        "document save failed"
                    );
                    send_save_result(
                        &document_tx,
                        workspace_id,
                        file_id,
                        request_id,
                        lifecycle.persisted_revision,
                        lifecycle.revision,
                        Some(error.to_string()),
                    )
                    .await;
                }
            }
            Ok(())
        }

        ClientMessage::DocUnsubscribe {
            workspace_id,
            file_id,
        } => {
            unsubscribe_doc(state, client_id, connection_id, workspace_id, file_id).await;
            Ok(())
        }

        ClientMessage::DocUpdate {
            workspace_id,
            file_id,
            update,
        } => {
            let workspace_id_copy = workspace_id.clone();
            let file_id_copy = file_id.clone();
            let doc = state
                .open_files
                .get(&(workspace_id.clone(), file_id.clone()))
                .map(|e| e.value().clone())
                .ok_or_else(move || {
                    anyhow::anyhow!("doc not open: {workspace_id:?}/{file_id:?}")
                })?;
            match doc.apply_remote_update(&update, client_id).await {
                Ok(generation) => {
                    let state = state.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        if doc.generation() != generation {
                            return; // a later edit landed — that window owns the sync now
                        }
                        match get_lsp_if_running(
                            &state,
                            workspace_id_copy.clone(),
                            file_id_copy.clone(),
                        )
                        .await
                        {
                            Ok(Some(lsp)) => {
                                if let Err(e) = doc.sync_to_lsp(&lsp).await {
                                    warn!(
                                        "failed to sync {workspace_id_copy}/{file_id_copy} to lsp: {e}"
                                    );
                                }
                            }
                            Ok(None) => {} // unsupported language, or server not attached yet
                            Err(e) => warn!(
                                "lsp lookup failed for {workspace_id_copy}/{file_id_copy}: {e}"
                            ),
                        }
                    });
                    Ok(())
                }
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

            let resolved_cwd = state.workspace_root(&workspace_id)?;
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
                Ok(Some(lsp)) => lsp,
                Ok(None) => {
                    document_tx
                        .send(ServerMessage::LspError {
                            request_id,
                            message: format!(
                                "no LSP configured for {:?}",
                                state.resolve_file_path(&workspace_id, &file_id)?
                            ),
                        })
                        .await
                        .ok();
                    return Ok(());
                }
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
    connection_id: u64,
    state: &AppState,
    document_tx: mpsc::Sender<ServerMessage>,
    terminal_tx: mpsc::Sender<ServerMessage>,
) -> ControlFlow<(), ()> {
    if !is_current_connection(state, &client_id, connection_id) {
        return ControlFlow::Break(());
    }
    match msg {
        Message::Text(t) => {
            debug!(">>> {who} sent str: {t:?}");
            match serde_json::from_str::<ClientMessage>(t) {
                Ok(message) => {
                    if let Err(err) = dispatch(
                        connection_id,
                        client_id,
                        message.clone(),
                        state,
                        document_tx,
                        terminal_tx,
                    )
                    .await
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
                if let Err(err) = dispatch(
                    connection_id,
                    client_id,
                    message.clone(),
                    state,
                    document_tx,
                    terminal_tx,
                )
                .await
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

fn is_current_connection(state: &AppState, client_id: &ClientId, connection_id: u64) -> bool {
    state
        .clients
        .get(client_id)
        .is_some_and(|handle| handle.connection_id == connection_id)
}

async fn cleanup_connection_resources(
    state: &AppState,
    client_id: &ClientId,
    handle: ClientConnectionHandle,
) {
    for entry in handle.doc_forwarders.iter() {
        entry.value().abort();
    }

    let subscriptions: Vec<_> = handle
        .subscribed_documents
        .iter()
        .map(|entry| entry.key().clone())
        .collect();
    for key in subscriptions {
        if let Some(document) = state.open_files.get(&key).map(|e| e.value().clone()) {
            document.unsubscribe(state.clone(), key).await;
        }
    }

    let terminals: Vec<_> = handle
        .open_terminals
        .iter()
        .map(|entry| entry.key().clone())
        .collect();
    for term_id in terminals {
        if let Some(terminal) = state.terminals.get(&term_id).map(|e| e.value().clone()) {
            // Disconnect is ephemeral for terminals; an explicitly closed
            // connection should not leave the process running.
            if terminal.unsubscribe(client_id) {
                terminal.kill().await.ok();
                state.terminals.remove(&term_id);
            }
        }
    }
}

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

async fn send_doc_state(
    document_tx: &mpsc::Sender<ServerMessage>,
    workspace_id: &WorkspaceId,
    file_id: &FileId,
    doc: &Arc<DocumentActor>,
) {
    let state = doc.lifecycle_snapshot().await;
    document_tx
        .send(ServerMessage::DocState {
            workspace_id: workspace_id.clone(),
            file_id: file_id.clone(),
            revision: state.revision,
            persisted_revision: state.persisted_revision,
            phase: state.phase,
            error: state.error,
        })
        .await
        .ok();
}

async fn send_doc_sync_step2(
    document_tx: &mpsc::Sender<ServerMessage>,
    workspace_id: &WorkspaceId,
    file_id: &FileId,
    doc: &Arc<DocumentActor>,
    update: Vec<u8>,
) {
    let state_vector = doc.state_vector().await;
    let lifecycle = doc.lifecycle_snapshot().await;
    document_tx
        .send(ServerMessage::DocSyncStep2 {
            workspace_id: workspace_id.clone(),
            file_id: file_id.clone(),
            update,
            state_vector: state_vector.encode_v1(),
            revision: lifecycle.revision,
            persisted_revision: lifecycle.persisted_revision,
        })
        .await
        .ok();
}

async fn send_save_result(
    document_tx: &mpsc::Sender<ServerMessage>,
    workspace_id: WorkspaceId,
    file_id: FileId,
    request_id: uuid::Uuid,
    saved_revision: u64,
    current_revision: u64,
    error: Option<String>,
) {
    document_tx
        .send(ServerMessage::DocSaveResult {
            workspace_id,
            file_id,
            request_id,
            saved_revision,
            current_revision,
            error,
        })
        .await
        .ok();
}

/// Spawns a task forwarding this doc's broadcast events to one client's
/// sender, and records the task so it can be aborted on unsubscribe/disconnect.
fn register_client_subscription(
    state: &AppState,
    client_id: ClientId,
    connection_id: u64,
    workspace_id: WorkspaceId,
    file_id: FileId,
    doc: &Arc<DocumentActor>,
    document_tx: mpsc::Sender<ServerMessage>,
) -> bool {
    let Some(client_handle) = state.clients.get(&client_id) else {
        return false;
    };
    if client_handle.connection_id != connection_id {
        return false;
    }
    let key = (workspace_id.clone(), file_id.clone());
    let handle = client_handle.value();

    if !handle.subscribed_documents.insert(key.clone()) {
        return false; // already subscribed — e.g. duplicate sync from a retry
    }

    let mut rx = doc.subscribe_events();
    let forwarder_doc = doc.clone();
    let workspace_id_cloned = workspace_id.clone();
    let forwarder = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(DocEvent::Update { update, origin }) => {
                    let file_id = forwarder_doc.file_id().await;
                    document_tx
                        .send(ServerMessage::DocUpdate {
                            workspace_id: workspace_id_cloned.clone(),
                            file_id,
                            update,
                            origin,
                        })
                        .await
                        .ok();
                }
                Ok(DocEvent::Awareness { payload, origin }) => {
                    let file_id = forwarder_doc.file_id().await;
                    document_tx
                        .send(ServerMessage::Awareness {
                            workspace_id: workspace_id_cloned.clone(),
                            file_id,
                            client_id: origin,
                            payload,
                        })
                        .await
                        .ok();
                }
                Ok(DocEvent::Diagnostics { diagnostics }) => {
                    let file_id = forwarder_doc.file_id().await;
                    document_tx
                        .send(ServerMessage::Diagnostics {
                            workspace_id: workspace_id_cloned.clone(),
                            file_id,
                            diagnostics,
                        })
                        .await
                        .ok();
                }
                Ok(DocEvent::State {
                    revision,
                    persisted_revision,
                    phase,
                    error,
                }) => {
                    let file_id = forwarder_doc.file_id().await;
                    document_tx
                        .send(ServerMessage::DocState {
                            workspace_id: workspace_id_cloned.clone(),
                            file_id,
                            revision,
                            persisted_revision,
                            phase,
                            error,
                        })
                        .await
                        .ok();
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(
                        "client lagged {n} doc events on {file_id:?}; forcing document sync"
                    );
                    let full = forwarder_doc.state_as_update(&StateVector::default()).await;
                    send_doc_sync_step2(
                        &document_tx,
                        &workspace_id_cloned,
                        &forwarder_doc.file_id().await,
                        &forwarder_doc,
                        full,
                    )
                    .await;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    handle.doc_forwarders.insert(key, forwarder);
    true
}

async fn unsubscribe_doc(
    state: &AppState,
    client_id: ClientId,
    connection_id: u64,
    workspace_id: WorkspaceId,
    file_id: FileId,
) {
    if !is_current_connection(state, &client_id, connection_id) {
        return;
    }
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
) -> anyhow::Result<Option<Arc<LspServerActor>>> {
    let path = state.resolve_file_path(workspace_id, file_id)?;
    let Some(language) = LanguageId::from_path(&path).await else {
        return Ok(None);
    };
    if !language.has_lsp_support() {
        return Ok(None);
    }

    let key = (workspace_id.clone(), language);
    if let Some(existing) = state.lsp_servers.get(&key) {
        return Ok(Some(existing.value().clone()));
    }

    let root = state.workspace_root(workspace_id)?;
    let actor = LspServerActor::spawn(
        Arc::new(state.clone()),
        &root,
        workspace_id.clone(),
        language,
    )
    .await?;

    match state.lsp_servers.entry(key) {
        Entry::Occupied(e) => Ok(Some(e.get().clone())), // another request won the race
        Entry::Vacant(e) => Ok(Some(e.insert(actor).clone())),
    }
}

async fn get_lsp_if_running(
    state: &AppState,
    workspace_id: WorkspaceId,
    file_id: FileId,
) -> anyhow::Result<Option<Arc<LspServerActor>>> {
    let path = state.resolve_file_path(&workspace_id, &file_id)?;
    let Some(language) = LanguageId::from_path(&path).await else {
        return Ok(None);
    };
    if !language.has_lsp_support() {
        return Ok(None);
    }
    Ok(state
        .lsp_servers
        .get(&(workspace_id, language))
        .map(|e| e.value().clone()))
}

fn doc_uri(
    state: &AppState,
    workspace_id: &WorkspaceId,
    file_id: &FileId,
) -> anyhow::Result<String> {
    Ok(format!(
        "file://{}",
        state.resolve_file_path(workspace_id, file_id)?.display()
    ))
}
