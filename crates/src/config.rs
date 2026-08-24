use std::env;
use std::path::PathBuf;
use std::str::FromStr;

use crate::models::FilePath;


#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub base_dir: PathBuf,
}

impl Config {
    pub fn new() -> Result<Self, anyhow::Error> {
        let port = u16::from_str(&env::var("PORT").unwrap_or("8080".to_string()))?;
        let base_dir = FilePath::new(env::var("BASE_DIRECTORY")?).to_os_path()?;

        Ok(Self {
            port,
            base_dir,
        })
    }
}