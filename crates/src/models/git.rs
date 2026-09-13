use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct GitStatus {
    pub workspace_id: String,
    pub generation: u64,
    pub branch: Option<String>,
    pub detached: bool,
    pub identity_configured: bool,
    pub can_push: bool,
    pub changes: Vec<GitChange>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct GitChange {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: Option<String>,
    pub worktree_status: Option<String>,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct GitDiff {
    pub workspace_id: String,
    pub generation: u64,
    pub path: String,
    pub view: String,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GitPathsRequest {
    pub workspace_id: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GitCommitRequest {
    pub workspace_id: String,
    pub message: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GitPushRequest {
    pub workspace_id: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct GitMutationResult {
    pub generation: u64,
    pub message: String,
}
