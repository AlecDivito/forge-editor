use rovo::schemars::JsonSchema;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct PublicEnvironment {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct PublicWorkspace {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct EnvironmentSnapshot {
    pub schema_version: u32,
    pub environment: PublicEnvironment,
    pub workspaces: Vec<PublicWorkspace>,
    pub default_workspace_id: String,
}
