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
        CreateFile, FilePath, FsFile, FsFileOperation, FsListDirectory, FsMoveFileResult, MovePath,
        MutationError, PaginationParams, SaveFile,
    },
    services::workspace_mutations,
    state::AppState,
    utils::workspace_mutation::normalize_workspace_relative,
};

#[derive(Deserialize, JsonSchema)]
pub struct WorkspaceQuery {
    pub workspace_id: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct MoveWorkspaceQuery {
    pub source_workspace_id: String,
    pub destination_workspace_id: Option<String>,
}

/// Get list of files for directory
///
/// # Responses
/// 200: Json<FsListDirectory> - Successfully list files
/// 400: () - Failed to get files
///
/// # Metadata
///
/// @tag fs
#[rovo]
pub async fn list_files(
    State(state): State<AppState>,
    Query(workspace): Query<WorkspaceQuery>,
    Query(path): Query<FilePath>,
    Query(pagination): Query<PaginationParams>,
) -> impl IntoApiResponse {
    list_files_impl(state, workspace.workspace_id, path, pagination)
        .await
        .into_response()
}

async fn list_files_impl(
    state: AppState,
    workspace_id: String,
    path: FilePath,
    pagination: PaginationParams,
) -> Result<impl IntoResponse, AppError> {
    let mut files = vec![];
    let relative_path = path.as_path_buf();
    let os_path = state.resolve_file_path(&workspace_id, &path.path)?;
    let mut dir_reader = match tokio::fs::read_dir(&os_path).await {
        Ok(dir) => dir,
        Err(_) => todo!(),
    };
    let mut index: usize = 0;
    let mut is_more = false;
    while let Some(entry) = dir_reader.next_entry().await? {
        if !pagination.get_index_range().contains(&index) && !pagination.get_read_all() {
            index += 1;
            continue;
        }
        if pagination.get_index_range().max().unwrap() <= index {
            is_more = true;
            break;
        }
        if let Ok(Some(file)) = FsFile::from_dir(relative_path, entry).await {
            index += 1;
            files.push(file);
        }
    }

    FsFile::sort(&mut files);

    Ok(Json(FsListDirectory {
        parent: path.path,
        files,
        pagination,
        is_more,
    }))
}

/// Update the contents of a file
///
/// # Responses
/// 200: Json<FsFileOperation> - Successfully created file/folder
/// 400: () - Failed to update content of the file
///
/// # Metadata
///
/// @tag fs
#[rovo]
pub async fn save_file(
    State(state): State<AppState>,
    Query(workspace): Query<WorkspaceQuery>,
    Json(body): Json<SaveFile>,
) -> impl IntoApiResponse {
    save_file_impl(state, workspace.workspace_id, body)
        .await
        .into_response()
}

async fn save_file_impl(
    state: AppState,
    workspace_id: String,
    body: SaveFile,
) -> Result<impl IntoResponse, AppError> {
    workspace_mutations::save_legacy(&state, &workspace_id, &body).await?;

    Ok(Json(FsFileOperation {
        success: true,
        path: body.path,
    }))
}

/// Create a file or directory
///
/// # Responses
/// 200: Json<CreateFile> - Successfully created file/folder
/// 400: () - Failed to move
///
/// # Metadata
///
/// @tag fs
#[rovo]
pub async fn create_file(
    State(state): State<AppState>,
    Query(workspace): Query<WorkspaceQuery>,
    Json(body): Json<CreateFile>,
) -> impl IntoApiResponse {
    create_file_impl(state, workspace.workspace_id, body)
        .await
        .into_response()
}

async fn create_file_impl(
    state: AppState,
    workspace_id: String,
    body: CreateFile,
) -> Result<impl IntoResponse, AppError> {
    workspace_mutations::create(&state, &workspace_id, &body).await?;

    Ok(Json(body))
}

/// Move a file or directory to a new location. The new location must not already
/// have an existing file
///
/// # Responses
/// 200: Json<FsMoveFileResult> - Successfully moved file or directory
/// 400: () - Failed to move
///
/// # Metadata
///
/// @tag fs
#[rovo]
pub async fn rename_file(
    State(state): State<AppState>,
    Query(workspace): Query<MoveWorkspaceQuery>,
    Json(path): Json<MovePath>,
) -> impl IntoApiResponse {
    rename_file_impl(state, workspace, path)
        .await
        .into_response()
}

async fn rename_file_impl(
    state: AppState,
    workspace: MoveWorkspaceQuery,
    path: MovePath,
) -> Result<impl IntoResponse, AppError> {
    let source_workspace_id = workspace.source_workspace_id;
    let destination_workspace_id = workspace
        .destination_workspace_id
        .unwrap_or_else(|| source_workspace_id.clone());
    if source_workspace_id != destination_workspace_id {
        return Err(AppError::String("cross-workspace moves are not yet supported; use copy followed by delete once copy semantics are available".into()));
    }
    normalize_workspace_relative(&path.from).map_err(mutation_error)?;
    let from_file = FsFile::from_app_state(
        &state,
        &source_workspace_id,
        std::path::Path::new(&path.from),
    )
    .map_err(AppError::from)?
    .ok_or_else(|| {
        AppError::String("Source file can't be moved because it does not exist".into())
    })?;
    workspace_mutations::rename(&state, &source_workspace_id, &path.from, &path.to)
        .await
        .map_err(mutation_error)?;
    let to_file =
        FsFile::from_app_state(&state, &source_workspace_id, std::path::Path::new(&path.to))
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::String("Moved file could not be found after rename".into()))?;

    Ok(Json(FsMoveFileResult {
        from: from_file,
        to: to_file,
    }))
}

/// Delete a file or directory
///
/// # Responses
/// 200: Json<FilePath> - Successfully deleted file or directory
/// 400: () - Failed to delete file or directory
///
/// # Metadata
///
/// @tag fs
#[rovo]
pub async fn delete_file(
    State(state): State<AppState>,
    Query(workspace): Query<WorkspaceQuery>,
    Json(body): Json<FilePath>,
) -> impl IntoApiResponse {
    delete_file_impl(state, workspace.workspace_id, body)
        .await
        .into_response()
}

async fn delete_file_impl(
    state: AppState,
    workspace_id: String,
    body: FilePath,
) -> Result<impl IntoResponse, AppError> {
    workspace_mutations::delete(&state, &workspace_id, &body.path)
        .await
        .map_err(mutation_error)?;

    Ok(Json(body))
}

fn mutation_error(error: MutationError) -> AppError {
    match error {
        MutationError::BadPath(message) => AppError::String(message),
        MutationError::NotFound(message) => AppError::String(message),
        MutationError::Conflict(message) => AppError::Conflict(message),
        MutationError::Io(error) => AppError::from(error),
    }
}
