use super::{AdapterCommand, AdapterTransport, DebugStrategy};
use crate::debug::{LaunchArguments, ResolvedConfiguration};
use serde_json::json;

pub(super) struct GoStrategy;

impl DebugStrategy for GoStrategy {
    fn display_name(&self) -> &'static str {
        "Delve (Go)"
    }
    fn command(&self) -> AdapterCommand {
        AdapterCommand {
            executable: "dlv".into(),
            arguments: vec!["dap".into()],
            transport: AdapterTransport::Loopback {
                arguments: vec!["--listen=127.0.0.1:{port}".into(), "--log=false".into()],
            },
            adapter_id: "go",
        }
    }
    fn launch_arguments(&self, configuration: &ResolvedConfiguration) -> LaunchArguments {
        LaunchArguments::from(configuration).with_adapter_field("mode", json!("debug"))
    }
}
