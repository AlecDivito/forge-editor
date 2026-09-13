use crate::{
    debug::{ConfigurationList, CreateSession, SessionSnapshot},
    error::AppError,
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rovo::schemars::JsonSchema;
use rovo::{axum::IntoApiResponse, rovo};
use serde::Deserialize;

/// Path parameters shared by workspace-level debug routes.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct DebugWorkspacePath {
    /// Public ID of the workspace containing the launch configuration.
    pub workspace_id: String,
}

/// Path parameters for routes addressing one debug session.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct DebugSessionPath {
    /// Public ID of the workspace that owns the session.
    pub workspace_id: String,
    /// Opaque server-issued debug session ID.
    pub session_id: String,
}

/// Discover the supported debug configurations for a workspace.
///
/// The response contains only public configuration summaries. Resolved host
/// paths, adapter commands, launch arguments, and environment values remain in
/// the debug service and are never serialized by this route.
///
/// # Path Parameters
/// workspace_id: String - Workspace containing `.vscode/launch.json`
///
/// # Responses
/// 200: Json<ConfigurationList> - Configuration summaries and diagnostics
/// 400: () - Unknown workspace or unreadable configuration
///
/// # Metadata
///
/// @tag debug
#[rovo]
pub async fn get_configurations(
    Path(DebugWorkspacePath { workspace_id }): Path<DebugWorkspacePath>,
    State(state): State<AppState>,
) -> impl IntoApiResponse {
    get_configurations_impl(workspace_id, state)
        .await
        .into_response()
}
async fn get_configurations_impl(
    workspace_id: String,
    state: AppState,
) -> Result<impl IntoResponse, AppError> {
    let root = state.workspace_root(&workspace_id)?;
    Ok(Json(
        state.debug.configurations(&root, &workspace_id).await?,
    ))
}

/// Create and register a launch-only debug session.
///
/// The browser selects a previously discovered configuration by its opaque ID
/// and revision. Adapter selection, path resolution, spawning, and ownership
/// remain server-controlled.
///
/// # Path Parameters
/// workspace_id: String - Workspace in which to launch the debug target
///
/// # Responses
/// 201: Json<SessionSnapshot> - Session admitted and registered
/// 400: () - Invalid workspace, configuration, or session limit
/// 409: () - Configuration revision is stale
///
/// # Metadata
///
/// @tag debug
#[rovo]
pub async fn create_session(
    Path(DebugWorkspacePath { workspace_id }): Path<DebugWorkspacePath>,
    State(state): State<AppState>,
    Json(body): Json<CreateSession>,
) -> impl IntoApiResponse {
    create_session_impl(workspace_id, state, body).await
}
async fn create_session_impl(
    workspace_id: String,
    state: AppState,
    body: CreateSession,
) -> Response {
    let result: Result<Response, AppError> = async {
        let root = state.workspace_root(&workspace_id)?;
        match state.debug.create(&root, &workspace_id, body).await {
            Ok(value) => Ok((StatusCode::CREATED, Json(value)).into_response()),
            Err(error) if error.to_string().contains("stale configuration") => {
                Err(AppError::Conflict(
                    "launch.json changed; refresh configurations and try again".into(),
                ))
            }
            Err(error) => Err(error.into()),
        }
    }
    .await;
    result.into_response()
}

/// Retrieve the current public snapshot of a debug session.
///
/// Session IDs are always checked against the workspace in the route. A
/// session belonging to another workspace is reported as unavailable rather
/// than disclosing its existence.
///
/// # Path Parameters
/// workspace_id: String - Workspace that owns the session
/// session_id: String - Opaque server-issued debug session ID
///
/// # Responses
/// 200: Json<SessionSnapshot> - Current lifecycle, output, and exit snapshot
/// 400: () - Unknown workspace or session
///
/// # Metadata
///
/// @tag debug
#[rovo]
pub async fn get_session(
    Path(DebugSessionPath {
        workspace_id,
        session_id,
    }): Path<DebugSessionPath>,
    State(state): State<AppState>,
) -> impl IntoApiResponse {
    let result: Result<_, AppError> = state
        .debug
        .get(&workspace_id, &session_id)
        .await
        .map(Json)
        .map_err(Into::into);
    result.into_response()
}

/// Terminate the debuggee and its server-owned adapter.
///
/// Stop is idempotent: terminating and terminal sessions return their current
/// snapshot. The debug service owns cleanup so HTTP cancellation cannot orphan
/// the adapter process.
///
/// # Path Parameters
/// workspace_id: String - Workspace that owns the session
/// session_id: String - Opaque server-issued debug session ID
///
/// # Responses
/// 200: Json<SessionSnapshot> - Current or newly terminating session snapshot
/// 400: () - Unknown workspace or session
///
/// # Metadata
///
/// @tag debug
#[rovo]
pub async fn stop_session(
    Path(DebugSessionPath {
        workspace_id,
        session_id,
    }): Path<DebugSessionPath>,
    State(state): State<AppState>,
) -> impl IntoApiResponse {
    let result: Result<_, AppError> = state
        .debug
        .stop(&workspace_id, &session_id)
        .await
        .map(Json)
        .map_err(Into::into);
    result.into_response()
}
