use std::path::{Path, PathBuf};

use crate::{
    models::{FileId, FsEntryType, MutationError},
    utils::workspace_path,
};

pub fn normalize_workspace_relative(raw: &str) -> Result<PathBuf, MutationError> {
    let normalized =
        workspace_path::normalize_workspace_relative(Path::new(raw)).map_err(|_| {
            MutationError::BadPath(format!("path must remain beneath the workspace: {raw}"))
        })?;
    if normalized.as_os_str().is_empty() {
        return Err(MutationError::BadPath(
            "workspace root is not a file entry".into(),
        ));
    }
    Ok(normalized)
}

pub fn display_relative(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    format!("/{value}")
}

pub fn canonical_file_id(path: &Path) -> FileId {
    format!("/{}", path.to_string_lossy().replace('\\', "/"))
}

pub async fn entry_type(path: &Path) -> Result<FsEntryType, MutationError> {
    let metadata = tokio::fs::symlink_metadata(path).await?;
    let ty = metadata.file_type();
    if ty.is_dir() {
        Ok(FsEntryType::Directory)
    } else if ty.is_symlink() {
        Ok(FsEntryType::Symlink)
    } else if ty.is_file() {
        Ok(FsEntryType::File)
    } else {
        Err(MutationError::BadPath(format!(
            "unsupported filesystem entry: {path:?}"
        )))
    }
}

pub async fn ensure_parent_inside(root: &Path, path: &Path) -> Result<(), MutationError> {
    let parent = path.parent().unwrap_or(root);
    let canonical_root = tokio::fs::canonicalize(root).await?;
    let canonical = tokio::fs::canonicalize(parent).await?;
    if !canonical.starts_with(&canonical_root) {
        return Err(MutationError::BadPath(
            "path escapes the workspace through a symlink".into(),
        ));
    }
    Ok(())
}

pub fn relative_actor_path(root: &Path, actor_path: &Path) -> Option<PathBuf> {
    actor_path.strip_prefix(root).ok().map(Path::to_path_buf)
}

pub fn is_affected(path: &Path, root: &Path, target: &Path, directory: bool) -> bool {
    let Some(relative) = relative_actor_path(root, path) else {
        return false;
    };
    relative == target || (directory && relative.starts_with(target))
}

pub fn remapped_path(path: &Path, from: &Path, to: &Path, directory: bool) -> PathBuf {
    if directory {
        to.join(path.strip_prefix(from).expect("affected path has prefix"))
    } else {
        to.to_path_buf()
    }
}
