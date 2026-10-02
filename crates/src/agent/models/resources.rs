use std::collections::BTreeMap;

use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One loaded filesystem resource with a stable catalog id.
#[derive(Clone, Debug)]
pub struct ResourceDocument {
    pub id: String,
    pub content: String,
    pub description: Option<String>,
    pub model_invocable: bool,
}

/// Metadata safe to expose to the composer. Skill instructions remain on the
/// server and enter a model context only through an explicit invocation or
/// the `load_skill` tool.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
pub struct AgentSkill {
    pub id: String,
    pub description: String,
    pub model_invocable: bool,
}

/// A user-managed rule included in the system context for every new turn.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AgentRule {
    /// Stable filesystem-safe identifier. Stored as `rules/<id>.md`.
    pub id: String,
    /// Markdown instruction supplied to the model.
    pub content: String,
}

/// Request body for creating or replacing one user-managed rule.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, JsonSchema)]
pub struct SaveAgentRule {
    pub content: String,
}

/// The immutable process-wide snapshot loaded from
/// `FORGE_AGENT_RESOURCES_DIR`.
#[derive(Clone, Debug, Default)]
pub struct AgentResources {
    pub(crate) skills: BTreeMap<String, ResourceDocument>,
    pub(crate) rules: BTreeMap<String, ResourceDocument>,
    pub(crate) prompts: BTreeMap<String, ResourceDocument>,
    pub(crate) bash_policy_prefixes: Vec<String>,
}
