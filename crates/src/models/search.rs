use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use crate::models::FsFile;

/// Cooperative cancellation shared by an HTTP handler and its blocking
/// filesystem worker. Dropping the handler signals the worker to stop.
pub struct SearchCancellation {
    cancelled: Arc<AtomicBool>,
    armed: bool,
}

impl SearchCancellation {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            armed: true,
        }
    }

    pub fn flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }

    pub fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Default for SearchCancellation {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for SearchCancellation {
    fn drop(&mut self) {
        if self.armed {
            self.cancelled.store(true, Ordering::Relaxed);
        }
    }
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct FsSearchResponse {
    pub results: Vec<FsSearchResult>,
    /// True when `max_results` stopped the search before every matching file
    /// could be returned.
    pub truncated: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct FsSearchResult {
    pub workspace_id: String,
    pub file: FsFile,
    pub matches: Vec<FsSearchLine>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct FsSearchLine {
    pub line: usize,
    pub text: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct FsSearchQuery {
    /// Text to search for.
    pub search: String,

    /// String to use during replace operation
    pub replace: String,

    /// Case-sensitive matching. Defaults to false.
    #[serde(default)]
    pub match_case: bool,

    /// Require the search text to be a whole word. Defaults to false.
    #[serde(default)]
    pub match_whole_word: bool,

    /// Treat `search` as a regular expression. Defaults to false.
    #[serde(default)]
    pub regex: bool,

    #[serde(default)]
    pub preserve_case: bool,

    /// Glob patterns for files to include.
    ///
    /// Examples:
    ///   *.rs
    ///   src/**
    ///   **/*.test.ts
    pub include: Option<String>,

    /// Glob patterns for files to exclude.
    pub exclude: Option<String>,

    /// Only search files currently open in the editor.
    #[serde(default)]
    pub open_files_only: bool,

    /// Whether filesystem ignore files such as .gitignore should be
    /// respected.
    ///
    #[serde(default = "default_use_ignore_files")]
    pub use_ignore_files: bool,

    /// Maximum number of matching files to return. Omit to return all matches.
    /// This is a result limit rather than filesystem pagination, since a stable
    /// filesystem snapshot cannot be guaranteed between requests.
    pub max_results: Option<usize>,
}

fn default_use_ignore_files() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct FsSearchHttpQuery {
    #[serde(flatten)]
    pub search: FsSearchQuery,
    /// Optional workspace filter. Omit to search every configured workspace.
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct SearchWorkspaceQuery {
    /// Optional workspace filter. Omit to search every configured workspace.
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct FileNameSearchQuery {
    pub search: String,
    pub workspace_id: Option<String>,
    /// Maximum number of matching files to return. Omit to return all matches.
    pub max_results: Option<usize>,
    /// Respect workspace, Git, and global ignore files. Defaults to true.
    #[serde(default = "default_use_ignore_files")]
    pub use_ignore_files: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct FileNameSearchResult {
    pub workspace_id: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct FileNameSearchResponse {
    pub results: Vec<FileNameSearchResult>,
    pub truncated: bool,
}
