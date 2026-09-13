use super::{AdapterCommand, AdapterTransport, DebugStrategy, common_launch};
use crate::debug::ResolvedConfiguration;
use serde_json::Value;

pub(super) struct RustStrategy;

impl DebugStrategy for RustStrategy {
    fn type_id(&self) -> &'static str {
        "forge-rust"
    }
    fn display_name(&self) -> &'static str {
        "LLDB (Rust)"
    }
    fn command(&self) -> AdapterCommand {
        AdapterCommand {
            executable: "lldb-dap".into(),
            arguments: vec![],
            transport: AdapterTransport::Stdio,
            adapter_id: "lldb",
        }
    }
    fn launch_arguments(&self, configuration: &ResolvedConfiguration) -> Value {
        common_launch(configuration)
    }
}
