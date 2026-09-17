use std::{
    fs::FileType,
    path::{Path, PathBuf},
};

use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::fs::DirEntry;

use crate::{
    models::{PaginationParams, WorkspaceId},
    state::AppState,
};

#[derive(Serialize, JsonSchema)]
pub struct FsListDirectory {
    pub parent: String,
    pub files: Vec<FsFile>,
    pub pagination: PaginationParams,
    pub is_more: bool,
}

#[derive(Serialize, JsonSchema)]
pub struct FsMoveFileResult {
    pub from: FsFile,
    pub to: FsFile,
}

#[derive(Serialize, JsonSchema)]
pub struct FsFileOperation {
    pub success: bool,
    pub path: String,
}

#[derive(Deserialize, Serialize, JsonSchema, Debug)]
pub enum FsFileType {
    Directory,
    File,
    SymLink,
}

impl FsFileType {
    pub fn new(file_type: FileType) -> Option<Self> {
        if file_type.is_file() {
            Some(Self::File)
        } else if file_type.is_dir() {
            Some(Self::Directory)
        } else if file_type.is_symlink() {
            Some(Self::SymLink)
        } else {
            None
        }
    }

    pub fn from_path(path: &Path) -> Option<Self> {
        if path.is_file() {
            Some(Self::File)
        } else if path.is_dir() {
            Some(Self::Directory)
        } else if path.is_symlink() {
            Some(Self::SymLink)
        } else {
            None
        }
    }

    pub fn order(&self) -> usize {
        match self {
            FsFileType::Directory => 0,
            FsFileType::File => 1,
            FsFileType::SymLink => 2,
        }
    }
}

#[derive(Serialize, JsonSchema, Debug)]
pub struct FsFile {
    name: Option<String>,
    pub path: String,
    parent: String,
    ty: FsFileType,
}

impl FsFile {
    pub fn from_path(path: &Path) -> Option<Self> {
        Some(Self {
            name: path.file_name().map(|f| f.to_string_lossy().to_string()),
            path: path.as_os_str().to_string_lossy().to_string(),
            parent: path
                .parent()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or("/".to_string()),
            ty: FsFileType::from_path(path)?,
        })
    }

    pub fn from_app_state(
        state: &AppState,
        workspace_id: &WorkspaceId,
        relative: &Path,
    ) -> anyhow::Result<Option<Self>> {
        return Self::from_base_path(&state.workspace_root(workspace_id)?, relative);
    }

    pub fn from_base_path(base: &Path, relative: &Path) -> anyhow::Result<Option<Self>> {
        let absolute_path = AppState::base_to_absolute_path(base, relative)?;
        if let Some(ty) = FsFileType::from_path(&absolute_path) {
            Ok(Some(Self {
                name: relative
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string()),
                path: relative.as_os_str().to_string_lossy().to_string(),
                parent: relative
                    .parent()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or("/".to_string()),
                ty,
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn from_dir(parent: &Path, entry: DirEntry) -> anyhow::Result<Option<Self>> {
        let path = parent.join(entry.file_name());
        let file_type = entry.file_type().await?;
        if let Some(ty) = FsFileType::new(file_type) {
            Ok(Some(Self {
                name: path.file_name().map(|f| f.to_string_lossy().to_string()),
                path: path.to_string_lossy().to_string(),
                parent: path
                    .parent()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or("/".to_string()),
                ty,
            }))
        } else {
            return Ok(None);
        }
    }

    pub fn sort(files: &mut Vec<Self>) {
        files.sort_by(|a, b| {
            a.ty.order()
                .cmp(&b.ty.order())
                .then_with(|| a.path.cmp(&b.path))
        });
    }

    pub async fn delete(self) -> tokio::io::Result<()> {
        let path = PathBuf::from(self.path);
        match self.ty {
            FsFileType::Directory => tokio::fs::remove_dir(path).await,
            FsFileType::File | FsFileType::SymLink => tokio::fs::remove_file(path).await,
        }
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct MovePath {
    pub from: String,
    pub to: String,
}

impl MovePath {
    pub fn to_file_path(self) -> (FilePath, FilePath) {
        (FilePath { path: self.from }, FilePath { path: self.to })
    }
}

#[derive(Deserialize, Serialize, JsonSchema)]
pub struct CreateFile {
    pub path: String,
    pub ty: FsFileType,
}

#[derive(Deserialize, Serialize, JsonSchema, Debug)]
pub struct FilePath {
    pub path: String,
}

impl FilePath {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }

    pub fn as_path_buf(&self) -> &Path {
        Path::new(&self.path)
    }

    pub fn to_os_path(&self) -> anyhow::Result<PathBuf> {
        let path = Path::new(&self.path);
        if !path.exists() {
            anyhow::bail!("Path {} does not exist", self.path)
        }
        Ok(path.to_path_buf())
    }

    pub fn with_path(&self, path: &Path) -> anyhow::Result<PathBuf> {
        let new_path = if self.as_path_buf().is_absolute() {
            path.join(Path::new(self.path.strip_prefix("/").unwrap_or("")))
        } else {
            path.join(self.as_path_buf())
        };
        if !new_path.exists() {
            anyhow::bail!("Path {} does not exist", self.path)
        }
        Ok(new_path.to_path_buf())
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct SaveFile {
    pub path: String,
    pub contents: Vec<u8>,
}
