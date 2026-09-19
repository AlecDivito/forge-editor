use super::{AdapterCommand, AdapterTransport, DebugStrategy};
use crate::debug::{LaunchArguments, ResolvedConfiguration};
use serde_json::json;
use std::path::{Path, PathBuf};

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
    fn debug_output_path(&self, session_id: &str) -> Option<PathBuf> {
        Some(
            std::env::temp_dir()
                .join("forge-debug")
                .join(format!("go-{session_id}")),
        )
    }
    fn launch_arguments(
        &self,
        configuration: &ResolvedConfiguration,
        debug_output: Option<&Path>,
    ) -> LaunchArguments {
        let arguments =
            LaunchArguments::from(configuration).with_adapter_field("mode", json!("debug"));
        match debug_output {
            Some(path) => arguments.with_adapter_field("output", json!(path)),
            None => arguments,
        }
    }
}
