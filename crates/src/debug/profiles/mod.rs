mod go;
mod node;
mod python;
mod rust;

use super::{PublicCapabilities, ResolvedConfiguration};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};

use self::{go::GoStrategy, node::NodeStrategy, python::PythonStrategy, rust::RustStrategy};

/// Private adapter transport selected by a server-owned strategy.
#[derive(Debug, Clone)]
pub enum AdapterTransport {
    Stdio,
    /// The `{port}` placeholder in an argument is replaced with an ephemeral
    /// loopback port selected by Forge immediately before spawning.
    Loopback {
        arguments: Vec<String>,
    },
}

/// Everything the lifecycle actor needs to spawn an approved adapter.
#[derive(Debug, Clone)]
pub struct AdapterCommand {
    pub executable: String,
    pub arguments: Vec<String>,
    pub transport: AdapterTransport,
    pub adapter_id: &'static str,
}

/// Adapter-specific policy and DAP payload construction.
pub trait DebugStrategy: Send + Sync {
    fn type_id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn capabilities(&self) -> PublicCapabilities {
        PublicCapabilities::default()
    }
    fn command(&self) -> AdapterCommand;
    fn launch_arguments(&self, configuration: &ResolvedConfiguration) -> Value;
}

#[derive(Clone)]
pub struct StrategyRegistry {
    strategies: Arc<HashMap<&'static str, Arc<dyn DebugStrategy>>>,
}

impl std::fmt::Debug for StrategyRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StrategyRegistry")
            .field("types", &self.strategies.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl Default for StrategyRegistry {
    fn default() -> Self {
        let strategies: Vec<Arc<dyn DebugStrategy>> = vec![
            Arc::new(RustStrategy),
            Arc::new(GoStrategy),
            Arc::new(NodeStrategy),
            Arc::new(PythonStrategy),
        ];
        Self {
            strategies: Arc::new(
                strategies
                    .into_iter()
                    .map(|strategy| (strategy.type_id(), strategy))
                    .collect(),
            ),
        }
    }
}

impl StrategyRegistry {
    pub fn get(&self, type_id: &str) -> Option<Arc<dyn DebugStrategy>> {
        self.strategies.get(type_id).cloned()
    }
    pub fn supported_types(&self) -> Vec<&'static str> {
        let mut types = self.strategies.keys().copied().collect::<Vec<_>>();
        types.sort_unstable();
        types
    }
}

pub(super) fn common_launch(configuration: &ResolvedConfiguration) -> Value {
    json!({
        "program": configuration.program, "cwd": configuration.cwd,
        "args": configuration.args, "env": configuration.env,
        "stopOnEntry": configuration.stop_on_entry,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registry_contains_primary_language_profiles() {
        assert_eq!(
            StrategyRegistry::default().supported_types(),
            vec!["forge-go", "forge-node", "forge-python", "forge-rust"]
        );
    }
}
