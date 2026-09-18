use super::{AdapterCommand, AdapterTransport, DebugStrategy};
use crate::debug::{LaunchArguments, ResolvedConfiguration};

pub(super) struct RustStrategy;

impl DebugStrategy for RustStrategy {
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
    fn launch_arguments(&self, configuration: &ResolvedConfiguration) -> LaunchArguments {
        LaunchArguments::from(configuration)
    }
}
