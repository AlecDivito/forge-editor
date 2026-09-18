use rovo::schemars::JsonSchema;
use serde::Serialize;
use std::{collections::HashMap, path::PathBuf};

/// Browser-safe summary of all configurations in one workspace.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationList {
    pub revision: String,
    pub configurations: Vec<ConfigurationSummary>,
    pub diagnostics: Vec<DebugDiagnostic>,
}

/// Browser-safe description of one launch configuration.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationSummary {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub request: String,
    pub valid: bool,
    pub warnings: Vec<String>,
    pub capabilities: PublicCapabilities,
}

#[derive(Debug, Clone, Default, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicCapabilities {
    pub integrated_terminal: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct DebugDiagnostic {
    pub path: String,
    pub message: String,
}

/// Server-only launch data. This must never be serialized to the browser.
#[derive(Debug, Clone)]
pub struct ResolvedConfiguration {
    pub id: String,
    pub name: String,
    pub adapter_type: String,
    pub program: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub stop_on_entry: bool,
}

/// Result of parsing one launch file, deliberately split between a public view
/// and the server-only resolved configurations used by later session code.
pub struct LoadedConfigurations {
    pub public: ConfigurationList,
    pub resolved: HashMap<String, ResolvedConfiguration>,
}
