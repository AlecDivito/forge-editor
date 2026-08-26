use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::models::FsFile;



#[derive(Debug, Serialize, JsonSchema)]
pub struct FsSearchResponse {
    pub results: Vec<FsSearchResult>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct FsSearchResult {
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

#[derive(Debug, Deserialize, JsonSchema)]
pub struct FsSearchQuery {
    /// Text to search for.
    pub search: String,

    /// Case-sensitive matching. Defaults to false.
    #[serde(default)]
    pub match_case: bool,

    /// Require the search text to be a whole word. Defaults to false.
    #[serde(default)]
    pub match_whole_word: bool,

    /// Treat `search` as a regular expression. Defaults to false.
    #[serde(default)]
    pub regex: bool,

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
    ///
    /// The plumbing is here, but the implementation can initially
    /// ignore this option.
    #[serde(default)]
    pub open_files_only: bool,

    /// Whether filesystem ignore files such as .gitignore should be
    /// respected.
    ///
    /// Currently this can default to false and be enabled later.
    #[serde(default)]
    pub use_ignore_files: bool,
}