use std::path::{Path, PathBuf};

use crate::config::Config;


#[derive(Debug, Clone)]
pub struct AppState {
    pub config: Config
}

impl AppState {
    pub fn to_absolute_path(&self, path: impl Into<PathBuf>) -> anyhow::Result<PathBuf> {
        return Self::base_to_absolute_path(&self.config.base_dir, &path.into())
    }

    pub fn base_to_absolute_path(base: &Path, relative: &Path) -> anyhow::Result<PathBuf> {
        Ok(if relative.is_absolute() {
            base.join(relative.strip_prefix("/")?)
        } else {
            base.join(relative)
        })
    }
}