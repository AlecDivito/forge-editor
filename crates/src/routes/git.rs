use std::sync::atomic::Ordering;

use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use rovo::schemars::JsonSchema;
use rovo::{axum::IntoApiResponse, rovo};
use serde::Deserialize;

use crate::{
    error::AppError,
    models::{
        GitCommitRequest, GitDiff, GitMutationResult, GitPathsRequest, GitPushRequest, GitStatus,
        ServerMessage,
    },
    services::git,
    state::AppState,
};

#[derive(Deserialize, JsonSchema)]
pub struct GitWorkspaceQuery {
    pub workspace_id: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct GitDiffQuery {
    pub workspace_id: String,
    pub path: String,
    pub view: String,
}

/// Read the current Git repository status for a workspace.
///
/// # Responses
/// 200: Json<GitStatus> - Current repository status
/// 400: () - Repository unavailable or status failed
#[rovo]
pub async fn get_status(
    State(state): State<AppState>,
    Query(query): Query<GitWorkspaceQuery>,
) -> impl IntoApiResponse {
    get_status_impl(state, query).await.into_response()
}
async fn get_status_impl(
    state: AppState,
    query: GitWorkspaceQuery,
) -> Result<Json<GitStatus>, AppError> {
    let workspace = state.workspace(&query.workspace_id)?;
    let generation = workspace.git_generation.load(Ordering::SeqCst);
    if !workspace.git_available {
        return Err(AppError::String(
            "Git is not available on the server".into(),
        ));
    }
    if !workspace.git_repository_present {
        return Err(AppError::String(
            "Workspace root is not a Git repository".into(),
        ));
    }
    Ok(Json(
        git::status(
            &state.workspace_root(&query.workspace_id)?,
            query.workspace_id,
            generation,
            workspace.git_identity_configured,
        )
        .await?,
    ))
}

/// Read the before and after contents for a Git comparison.
///
/// # Responses
/// 200: Json<GitDiff> - File comparison contents
/// 400: () - Invalid path, view, or repository
#[rovo]
pub async fn get_diff(
    State(state): State<AppState>,
    Query(query): Query<GitDiffQuery>,
) -> impl IntoApiResponse {
    get_diff_impl(state, query).await.into_response()
}
async fn get_diff_impl(state: AppState, query: GitDiffQuery) -> Result<Json<GitDiff>, AppError> {
    if query.view != "working" && query.view != "staged" {
        return Err(AppError::String("view must be working or staged".into()));
    }
    let workspace = state.workspace(&query.workspace_id)?;
    let generation = workspace.git_generation.load(Ordering::SeqCst);
    Ok(Json(
        git::diff(
            &state.workspace_root(&query.workspace_id)?,
            query.workspace_id,
            generation,
            &query.path,
            &query.view,
        )
        .await?,
    ))
}

fn changed(state: &AppState, workspace_id: &str, reason: &str) -> u64 {
    let workspace = state
        .workspace(&workspace_id.to_string())
        .expect("validated workspace");
    let generation = workspace.git_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let message = ServerMessage::GitChanged {
        workspace_id: workspace_id.into(),
        generation,
        reason: reason.into(),
    };
    for client in state.clients.iter() {
        let _ = client.document_tx.try_send(message.clone());
    }
    generation
}

/// Stage one or more workspace files.
///
/// # Responses
/// 200: Json<GitMutationResult> - Files staged
/// 400: () - Staging failed
#[rovo]
pub async fn stage(
    State(state): State<AppState>,
    Json(body): Json<GitPathsRequest>,
) -> impl IntoApiResponse {
    stage_impl(state, body).await.into_response()
}
async fn stage_impl(
    state: AppState,
    body: GitPathsRequest,
) -> Result<Json<GitMutationResult>, AppError> {
    if body.paths.is_empty() {
        return Err(AppError::String("At least one path is required".into()));
    }
    let workspace = state.workspace(&body.workspace_id)?;
    let _guard = workspace.git_mutation_lock.lock().await;
    git::stage(&state.workspace_root(&body.workspace_id)?, &body.paths).await?;
    let generation = changed(&state, &body.workspace_id, "stage");
    Ok(Json(GitMutationResult {
        generation,
        message: "Files staged".into(),
    }))
}

/// Unstage one or more workspace files.
///
/// # Responses
/// 200: Json<GitMutationResult> - Files unstaged
/// 400: () - Unstaging failed
#[rovo]
pub async fn unstage(
    State(state): State<AppState>,
    Json(body): Json<GitPathsRequest>,
) -> impl IntoApiResponse {
    unstage_impl(state, body).await.into_response()
}
async fn unstage_impl(
    state: AppState,
    body: GitPathsRequest,
) -> Result<Json<GitMutationResult>, AppError> {
    if body.paths.is_empty() {
        return Err(AppError::String("At least one path is required".into()));
    }
    let workspace = state.workspace(&body.workspace_id)?;
    let _guard = workspace.git_mutation_lock.lock().await;
    git::unstage(&state.workspace_root(&body.workspace_id)?, &body.paths).await?;
    let generation = changed(&state, &body.workspace_id, "unstage");
    Ok(Json(GitMutationResult {
        generation,
        message: "Files unstaged".into(),
    }))
}

/// Commit the explicitly staged files.
///
/// # Responses
/// 200: Json<GitMutationResult> - Commit created
/// 400: () - Commit failed
#[rovo]
pub async fn commit(
    State(state): State<AppState>,
    Json(body): Json<GitCommitRequest>,
) -> impl IntoApiResponse {
    commit_impl(state, body).await.into_response()
}
async fn commit_impl(
    state: AppState,
    body: GitCommitRequest,
) -> Result<Json<GitMutationResult>, AppError> {
    let workspace = state.workspace(&body.workspace_id)?;
    let _guard = workspace.git_mutation_lock.lock().await;
    let sha = git::commit(&state.workspace_root(&body.workspace_id)?, &body.message).await?;
    let generation = changed(&state, &body.workspace_id, "commit");
    Ok(Json(GitMutationResult {
        generation,
        message: sha,
    }))
}

/// Push the current branch to its configured upstream.
///
/// # Responses
/// 200: Json<GitMutationResult> - Push completed
/// 400: () - Push failed
#[rovo]
pub async fn push(
    State(state): State<AppState>,
    Json(body): Json<GitPushRequest>,
) -> impl IntoApiResponse {
    push_impl(state, body).await.into_response()
}
async fn push_impl(
    state: AppState,
    body: GitPushRequest,
) -> Result<Json<GitMutationResult>, AppError> {
    let workspace = state.workspace(&body.workspace_id)?;
    let _guard = workspace.git_mutation_lock.lock().await;
    git::push(&state.workspace_root(&body.workspace_id)?).await?;
    let generation = changed(&state, &body.workspace_id, "push");
    Ok(Json(GitMutationResult {
        generation,
        message: "Push completed".into(),
    }))
}
