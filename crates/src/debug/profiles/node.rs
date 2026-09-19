use super::{AdapterCommand, AdapterTransport, DebugStrategy};
use crate::debug::{LaunchArguments, ResolvedConfiguration};
use serde_json::json;
use std::path::PathBuf;

pub(super) struct NodeStrategy;

impl DebugStrategy for NodeStrategy {
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
    fn launch_arguments(
        &self,
        configuration: &ResolvedConfiguration,
        _debug_output: Option<&std::path::Path>,
    ) -> LaunchArguments {
        LaunchArguments::from(configuration).with_adapter_field("type", json!("pwa-node"))
    }
}
