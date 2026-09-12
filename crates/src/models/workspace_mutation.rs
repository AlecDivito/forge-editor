use super::FsEntryType;

#[derive(Debug)]
pub enum MutationError {
    BadPath(String),
    NotFound(String),
    Conflict(String),
    Io(std::io::Error),
}

impl std::fmt::Display for MutationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadPath(message) | Self::NotFound(message) | Self::Conflict(message) => {
                f.write_str(message)
            }
            Self::Io(error) => write!(f, "FS Error: {error}"),
        }
    }
}

impl std::error::Error for MutationError {}

impl From<std::io::Error> for MutationError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

#[derive(Debug, Clone)]
pub struct RenameCommit {
    pub from: String,
    pub to: String,
    pub entry_type: FsEntryType,
}

#[derive(Debug, Clone)]
pub struct DeleteCommit {
    pub path: String,
    pub entry_type: FsEntryType,
    pub affected_paths: Vec<String>,
}
