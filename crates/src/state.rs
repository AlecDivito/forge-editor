use std::path::PathBuf;

use crate::config::Config;


#[derive(Debug, Clone)]
pub struct AppState {
    pub config: Config
}

impl AppState {
    pub fn to_absolute_path(&self, path: impl Into<PathBuf>) -> anyhow::Result<PathBuf> {
        let path = path.into();
        Ok(if path.is_absolute() {
            self.config.base_dir.join(path.strip_prefix("/")?)
        } else {
            self.config.base_dir.join(path)
        })
    }
}