use super::{AdapterCommand, AdapterTransport, DebugStrategy, common_launch};
use crate::debug::ResolvedConfiguration;
use serde_json::{Value, json};

pub(super) struct GoStrategy;

impl DebugStrategy for GoStrategy {
    fn type_id(&self) -> &'static str {
        "forge-go"
    }
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
    fn launch_arguments(&self, configuration: &ResolvedConfiguration) -> Value {
        let mut value = common_launch(configuration);
        value["mode"] = json!("debug");
        value
    }
}
