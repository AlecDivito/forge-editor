use rovo::schemars::JsonSchema;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct AgentModelDescriptor {
    pub id: String,
    pub label: String,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct AgentModelCatalog {
    pub configured: bool,
    pub models: Vec<AgentModelDescriptor>,
}
