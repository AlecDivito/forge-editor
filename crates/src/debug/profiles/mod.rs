mod factory;
mod go;
mod node;
mod python;
mod rust;

use super::{LaunchArguments, PublicCapabilities, ResolvedConfiguration};
use std::path::{Path, PathBuf};

pub use factory::strategy_for;

/// Private adapter transport selected by a server-owned strategy.
#[derive(Debug, Clone)]
pub enum AdapterTransport {
    Stdio,
    /// The `{port}` placeholder in an argument is replaced with an ephemeral
    /// loopback port selected by Forge immediately before spawning.
    Loopback {
        arguments: Vec<String>,
    },
}

/// Everything the lifecycle actor needs to spawn an approved adapter.
#[derive(Debug, Clone)]
pub struct AdapterCommand {
    pub executable: String,
    pub arguments: Vec<String>,
    pub transport: AdapterTransport,
    pub adapter_id: &'static str,
}

/// Adapter-specific policy and DAP payload construction.
pub trait DebugStrategy: Send + Sync {
    fn display_name(&self) -> &'static str;
    fn capabilities(&self) -> PublicCapabilities {
        PublicCapabilities::default()
    }
    fn command(&self) -> AdapterCommand;
    /// Returns a Forge-managed path for an adapter build artifact, when the
    /// adapter supports one. The actor creates its parent and removes the
    /// artifact after the session.
    fn debug_output_path(&self, _session_id: &str) -> Option<PathBuf> {
        None
    }
    fn launch_arguments(
        &self,
        configuration: &ResolvedConfiguration,
        debug_output: Option<&Path>,
    ) -> LaunchArguments;
}
