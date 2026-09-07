use std::{path::Path};

use axum::{Json, extract::{Query, State}, response::IntoResponse};
use rovo::{axum::IntoApiResponse, rovo};

use crate::{error::AppError, models::{CreateFile, FilePath, FsFile, FsFileOperation, FsFileType, FsListDirectory, FsMoveFileResult, MovePath, PaginationParams, SaveFile}, state::AppState};



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
    Query(path): Query<FilePath>,
    Query(pagination): Query<PaginationParams>,
) -> impl IntoApiResponse {
    list_files_impl(state, path, pagination)
        .await
        .into_response()
}

async fn list_files_impl(
    state: AppState,
    path: FilePath,
    pagination: PaginationParams,
) -> Result<impl IntoResponse, AppError> {
    let mut files = vec![];
    let relative_path = path.as_path_buf();
    let os_path = path.with_path(&state.config.base_dir)?;
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
    Json(body): Json<SaveFile>,
) -> impl IntoApiResponse {
    save_file_impl(state, body).await.into_response()
}

async fn save_file_impl(
    state: AppState,
    body: SaveFile,
) -> Result<impl IntoResponse, AppError> {
    let local_path = state.to_absolute_path(&body.path)?;
    if local_path.is_file() {
        tokio::fs::write(local_path, body.contents).await?;
    } else {
        return Err(AppError::String(format!("Updating non file is not supported")))
    }
    
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
    Json(body): Json<CreateFile>,
) -> impl IntoApiResponse {
    create_file_impl(state, body).await.into_response()
}

async fn create_file_impl(
    state: AppState,
    body: CreateFile,
) -> Result<impl IntoResponse, AppError> {
    let local_path = state.to_absolute_path(&body.path)?;
    match body.ty {
        FsFileType::Directory => tokio::fs::create_dir(local_path).await?,
        FsFileType::File => tokio::fs::write(local_path, "").await?,
        FsFileType::SymLink => return Err(AppError::String("Creating sym link is not supported".into())),
    }
    
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
    Json(path): Json<MovePath>,
) -> impl IntoApiResponse {
    rename_file_impl(state, path).await.into_response()
}

async fn rename_file_impl(
    state: AppState,
    path: MovePath,
) -> Result<impl IntoResponse, AppError> {
    let (from, to) = path.to_file_path();
    let to_path = state.to_absolute_path(to.path.clone())?;
    let from_path = state.to_absolute_path(from.path.clone())?;
    println!("{:?} ({}) -> {:?} ({})", from_path, from_path.try_exists()?, to_path, to_path.try_exists()?);
    if !from_path.try_exists()? {
        return Err(AppError::String("Source file can't be moved because it does not exist".into()))
    }
    if to_path.try_exists()? {
        return Err(AppError::String("File can't be moved because it already exists in end result location".into()))
    }
    
    let from_file = FsFile::from_app_state(&state, Path::new(&from.path)).unwrap().unwrap();
    std::fs::rename(from_path, to_path)?;
    let to_file = FsFile::from_app_state(&state, Path::new(&to.path)).unwrap().unwrap();

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
    Json(body): Json<FilePath>,
) -> impl IntoApiResponse {
    delete_file_impl(state, body).await.into_response()
}

async fn delete_file_impl(
    state: AppState,
    body: FilePath,
) -> Result<impl IntoResponse, AppError> {
    let os_path = body.with_path(&state.config.base_dir)?;
    if let Some(file) = FsFile::from_path(&os_path) {
        file.delete().await?;
    } else {
        return Err(AppError::String(format!("File '{}' does not exist. Failed to delete file.", body.path)))
    }

    Ok(Json(body))
}