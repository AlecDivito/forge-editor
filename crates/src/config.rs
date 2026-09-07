use std::env;
use std::path::PathBuf;
use std::str::FromStr;

use crate::models::FilePath;


#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub base_dir: PathBuf,
    // Current only one workspace is supported through the base directory, however
    // i think i want to add in a WORKSPACE_X_{BASE_DIR,NAME,ECT} enviornment variable.
    // This will allow for openning multiple projects when the editor is openned.
    // The server environments configure how to configure the server.

    // TODO: include a way to set a token which should be checked on every API route.
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