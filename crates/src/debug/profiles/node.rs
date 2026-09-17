use super::{AdapterCommand, AdapterTransport, DebugStrategy, common_launch};
use crate::debug::ResolvedConfiguration;
use serde_json::{Value, json};
use std::path::PathBuf;

pub(super) struct NodeStrategy;

impl DebugStrategy for NodeStrategy {
    fn type_id(&self) -> &'static str {
        "forge-node"
    }
    fn display_name(&self) -> &'static str {
        "js-debug (JavaScript/TypeScript)"
    }
    fn command(&self) -> AdapterCommand {
        let script = std::env::var("FORGE_JS_DEBUG_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/opt/forge/js-debug/src/dapDebugServer.js"));
        AdapterCommand {
            executable: "node".into(),
            arguments: vec![script.to_string_lossy().into_owned()],
            transport: AdapterTransport::Loopback {
                arguments: vec!["{port}".into()],
            },
            adapter_id: "pwa-node",
        }
    }
    fn launch_arguments(&self, configuration: &ResolvedConfiguration) -> Value {
        let mut value = common_launch(configuration);
        value["type"] = json!("pwa-node");
        value
    }
}
