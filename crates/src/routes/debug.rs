use crate::{
    debug::{
        BreakpointList, ConfigurationList, CreateBreakpoint, CreateSession, DeleteBreakpoint,
        RequestedSourceBreakpoint, SessionSnapshot, UpdateBreakpoint,
    },
    error::AppError,
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, Query, State},
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

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DebugBreakpointPath {
    pub workspace_id: String,
    pub breakpoint_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugControlQuery {
    pub principal_id: String,
}

#[rovo]
pub async fn list_breakpoints(
    Path(DebugWorkspacePath { workspace_id }): Path<DebugWorkspacePath>,
    State(state): State<AppState>,
) -> impl IntoApiResponse {
    let result: Result<_, AppError> = async {
        state.workspace(&workspace_id)?;
        Ok(Json::<BreakpointList>(
            state.debug.breakpoints.list(&workspace_id).await,
        ))
    }
    .await;
    result.into_response()
}

#[rovo]
pub async fn create_breakpoint(
    Path(DebugWorkspacePath { workspace_id }): Path<DebugWorkspacePath>,
    State(state): State<AppState>,
    Json(body): Json<CreateBreakpoint>,
) -> impl IntoApiResponse {
    let result: Result<_, AppError> = async {
        state.resolve_file_path(&workspace_id, &body.file_id)?;
        let created = state.debug.breakpoints.create(&workspace_id, body).await?;
        Ok(Json::<RequestedSourceBreakpoint>(created))
    }
    .await;
    match result {
        Err(AppError::GenericError(ref e)) if e.to_string().contains("result_too_large") => {
            (StatusCode::PAYLOAD_TOO_LARGE, e.to_string()).into_response()
        }
        other => other.into_response(),
    }
}

#[rovo]
pub async fn update_breakpoint(
    Path(path): Path<DebugBreakpointPath>,
    State(state): State<AppState>,
    Json(body): Json<UpdateBreakpoint>,
) -> impl IntoApiResponse {
    update_breakpoint_impl(path, state, body).await
}
async fn update_breakpoint_impl(
    DebugBreakpointPath {
        workspace_id,
        breakpoint_id,
    }: DebugBreakpointPath,
    state: AppState,
    body: UpdateBreakpoint,
) -> Response {
    match state
        .debug
        .breakpoints
        .update(&workspace_id, &breakpoint_id, body)
        .await
    {
        Ok(value) => Json(value).into_response(),
        Err(error) if error.to_string().contains("revision_conflict") => {
            (StatusCode::CONFLICT, error.to_string()).into_response()
        }
        Err(error) => AppError::from(error).into_response(),
    }
}

#[rovo]
pub async fn delete_breakpoint(
    Path(path): Path<DebugBreakpointPath>,
    State(state): State<AppState>,
    Json(body): Json<DeleteBreakpoint>,
) -> impl IntoApiResponse {
    delete_breakpoint_impl(path, state, body).await
}
async fn delete_breakpoint_impl(
    DebugBreakpointPath {
        workspace_id,
        breakpoint_id,
    }: DebugBreakpointPath,
    state: AppState,
    body: DeleteBreakpoint,
) -> Response {
    match state
        .debug
        .breakpoints
        .delete(&workspace_id, &breakpoint_id, body.expected_revision)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) if error.to_string().contains("revision_conflict") => {
            (StatusCode::CONFLICT, error.to_string()).into_response()
        }
        Err(error) => AppError::from(error).into_response(),
    }
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
    Query(control): Query<DebugControlQuery>,
    State(state): State<AppState>,
) -> impl IntoApiResponse {
    let result: Result<_, AppError> = state
        .debug
        .stop(&control.principal_id, &workspace_id, &session_id)
        .await
        .map(Json)
        .map_err(Into::into);
    result.into_response()
}

/// Terminate a session and create a replacement with a new identity.
#[rovo]
pub async fn restart_session(
    Path(DebugSessionPath {
        workspace_id,
        session_id,
    }): Path<DebugSessionPath>,
    Query(control): Query<DebugControlQuery>,
    State(state): State<AppState>,
) -> impl IntoApiResponse {
    let result: Result<_, AppError> = async {
        let root = state.workspace_root(&workspace_id)?;
        Ok(Json::<SessionSnapshot>(
            state
                .debug
                .restart(&control.principal_id, &root, &workspace_id, &session_id)
                .await?,
        ))
    }
    .await;
    result.into_response()
}
