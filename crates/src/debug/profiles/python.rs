use super::{AdapterCommand, AdapterTransport, DebugStrategy, common_launch};
use crate::debug::ResolvedConfiguration;
use serde_json::{Value, json};

pub(super) struct PythonStrategy;

impl DebugStrategy for PythonStrategy {
    fn type_id(&self) -> &'static str {
        "forge-python"
    }
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
    fn launch_arguments(&self, configuration: &ResolvedConfiguration) -> Value {
        let mut value = common_launch(configuration);
        value["console"] = json!("internalConsole");
        value["justMyCode"] = json!(true);
        value
    }
}
