use super::{AdapterCommand, AdapterTransport, DebugStrategy};
use crate::debug::{LaunchArguments, ResolvedConfiguration};
use serde_json::json;

pub(super) struct PythonStrategy;

impl DebugStrategy for PythonStrategy {
    fn display_name(&self) -> &'static str {
        "debugpy (Python)"
    }
    fn command(&self) -> AdapterCommand {
        AdapterCommand {
            executable: "python3".into(),
            arguments: vec!["-m".into(), "debugpy.adapter".into()],
            transport: AdapterTransport::Stdio,
            adapter_id: "python",
        }
    }
    fn launch_arguments(
        &self,
        configuration: &ResolvedConfiguration,
        _debug_output: Option<&std::path::Path>,
    ) -> LaunchArguments {
        LaunchArguments::from(configuration)
            .with_adapter_field("console", json!("internalConsole"))
            .with_adapter_field("justMyCode", json!(true))
    }
}
