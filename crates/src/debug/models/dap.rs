use super::ResolvedConfiguration;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf};

/// Arguments Forge sends in the DAP `initialize` request.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeArguments {
    #[serde(rename = "clientID")]
    client_id: &'static str,
    client_name: &'static str,
    #[serde(rename = "adapterID")]
    adapter_id: String,
    path_format: &'static str,
    lines_start_at_1: bool,
    columns_start_at_1: bool,
    supports_run_in_terminal_request: bool,
}

impl InitializeArguments {
    pub(crate) fn forge(adapter_id: impl Into<String>) -> Self {
        Self {
            client_id: "forge",
            client_name: "Forge",
            adapter_id: adapter_id.into(),
            path_format: "path",
            lines_start_at_1: true,
            columns_start_at_1: true,
            supports_run_in_terminal_request: false,
        }
    }
}

/// Common DAP launch fields plus adapter-specific extensions.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchArguments {
    program: PathBuf,
    cwd: PathBuf,
    args: Vec<String>,
    env: HashMap<String, String>,
    stop_on_entry: bool,
    #[serde(flatten)]
    adapter_fields: serde_json::Map<String, Value>,
}

impl LaunchArguments {
    pub(crate) fn with_adapter_field(mut self, name: impl Into<String>, value: Value) -> Self {
        self.adapter_fields.insert(name.into(), value);
        self
    }
}

impl From<&ResolvedConfiguration> for LaunchArguments {
    fn from(configuration: &ResolvedConfiguration) -> Self {
        Self {
            program: configuration.program.clone(),
            cwd: configuration.cwd.clone(),
            args: configuration.args.clone(),
            env: configuration.env.clone(),
            stop_on_entry: configuration.stop_on_entry,
            adapter_fields: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DisconnectArguments {
    pub(crate) terminate_debuggee: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct Request<A> {
    pub(crate) seq: u64,
    #[serde(rename = "type")]
    pub(crate) kind: &'static str,
    pub(crate) command: &'static str,
    pub(crate) arguments: A,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Response {
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) request_seq: u64,
    pub(crate) success: bool,
    #[serde(default)]
    pub(crate) message: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct EmptyArguments {}

/// DAP events the current debug actor understands.
#[derive(Debug)]
pub(crate) enum Event {
    Output { category: String, output: String },
    Exited { exit_code: Option<i32> },
    Terminated,
    Unknown,
}

impl Event {
    pub(crate) fn from_message(message: Value) -> Self {
        match message["event"].as_str() {
            Some("output") => Self::Output {
                category: message["body"]["category"]
                    .as_str()
                    .unwrap_or("console")
                    .to_owned(),
                output: message["body"]["output"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
            },
            Some("exited") => Self::Exited {
                exit_code: message["body"]["exitCode"]
                    .as_i64()
                    .map(|value| value as i32),
            },
            Some("terminated") => Self::Terminated,
            _ => Self::Unknown,
        }
    }
}
