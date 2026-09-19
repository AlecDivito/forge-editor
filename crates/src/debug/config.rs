use super::{models::*, strategy_for};
use crate::models::WorkspaceId;
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchFile {
    #[serde(default)]
    _version: Option<String>,
    configurations: Vec<RawConfiguration>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConfiguration {
    name: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default = "launch_request")]
    request: String,
    program: String,
    cwd: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    stop_on_entry: Option<bool>,
}

fn launch_request() -> String {
    "launch".into()
}

/// Owns one workspace's configuration policy and parsing boundary.
///
/// This is deliberately the sole entry point for launch configuration: callers
/// cannot obtain a resolved configuration without first passing through the
/// same validation and sanitization rules.
pub struct ConfigurationLoader<'a> {
    root: &'a Path,
    workspace_id: &'a WorkspaceId,
}

impl<'a> ConfigurationLoader<'a> {
    pub fn new(root: &'a Path, workspace_id: &'a WorkspaceId) -> Self {
        Self { root, workspace_id }
    }

    pub async fn load(&self) -> anyhow::Result<LoadedConfigurations> {
        let path = self.root.join(".vscode/launch.json");
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LoadedConfigurations {
                    public: ConfigurationList {
                        revision: Self::revision(b"missing"),
                        configurations: vec![],
                        diagnostics: vec![],
                    },
                    resolved: HashMap::new(),
                });
            }
            Err(error) => return Err(error.into()),
        };
        self.parse(&bytes)
    }

    /// Parse one launch file without performing I/O or interacting with an adapter.
    ///
    /// Keeping parsing separate from `load` makes the configuration boundary
    /// directly testable and ensures later session code cannot accidentally accept
    /// unvalidated launch data.
    pub fn parse(&self, bytes: &[u8]) -> anyhow::Result<LoadedConfigurations> {
        let root = self
            .root
            .canonicalize()
            .map_err(|_| anyhow::anyhow!("workspace root does not exist"))?;
        let rev = Self::revision(bytes);
        let text =
            std::str::from_utf8(bytes).map_err(|_| anyhow::anyhow!("launch.json must be UTF-8"))?;
        let file: LaunchFile = serde_json::from_str(text)?;
        let mut summaries = vec![];
        let mut resolved = HashMap::new();
        for raw in file.configurations {
            let id = self.stable_id(&raw.name, &raw.kind);
            let capabilities = strategy_for(&raw.kind)
                .map(|strategy| strategy.capabilities())
                .unwrap_or_default();
            let program = Self::resolve_path(&root, &raw.program)?;
            let cwd =
                Self::resolve_path(&root, raw.cwd.as_deref().unwrap_or("${workspaceFolder}"))?;
            summaries.push(ConfigurationSummary {
                id: id.clone(),
                name: raw.name.clone(),
                kind: raw.kind.clone(),
                request: raw.request,
                valid: true,
                warnings: vec![],
                capabilities,
            });
            resolved.insert(
                id.clone(),
                ResolvedConfiguration {
                    id,
                    name: raw.name,
                    adapter_type: raw.kind,
                    program,
                    cwd,
                    args: raw.args,
                    env: raw.env,
                    stop_on_entry: raw.stop_on_entry.unwrap_or(false),
                },
            );
        }
        Ok(LoadedConfigurations {
            public: ConfigurationList {
                revision: rev,
                configurations: summaries,
                diagnostics: vec![],
            },
            resolved,
        })
    }

    fn resolve_path(root: &Path, value: &str) -> anyhow::Result<PathBuf> {
        let value = value.replace("${workspaceFolder}", root.to_string_lossy().as_ref());
        let candidate = PathBuf::from(value);
        let candidate = if candidate.is_absolute() {
            candidate
        } else {
            root.join(candidate)
        };
        let canonical = candidate
            .canonicalize()
            .map_err(|_| anyhow::anyhow!("path does not exist"))?;
        if !canonical.starts_with(root) {
            anyhow::bail!("path resolves outside the workspace");
        }
        Ok(canonical)
    }

    fn stable_id(&self, name: &str, kind: &str) -> String {
        Self::revision(format!("{}\0{name}\0{kind}", self.workspace_id).as_bytes())
    }

    fn revision(bytes: &[u8]) -> String {
        // Fixed FNV-1a avoids the implementation-defined behavior of DefaultHasher
        // and makes revisions stable across Forge processes.
        let hash = bytes.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
        format!("{hash:016x}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("forge-debug-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("main.go"), "package main\nfunc main() {}\n").unwrap();
        root
    }

    fn parse_workspace(root: &Path, input: &str) -> LoadedConfigurations {
        let workspace_id = "workspace-a".to_owned();
        ConfigurationLoader::new(root, &workspace_id)
            .parse(input.as_bytes())
            .unwrap()
    }

    #[test]
    fn parses_plain_json_without_configuration_policy() {
        let root = workspace();
        let loaded = parse_workspace(
            &root,
            r#"{
                "configurations": [{
                    "name": "Go server",
                    "type": "forge-go",
                    "program": "${workspaceFolder}/main.go",
                    "cwd": "${workspaceFolder}",
                    "args": ["${env:PORT}"],
                    "env": {"BAD=NAME": "8080"},
                    "futureExtension": true
                }]
            }"#,
        );
        let summary = &loaded.public.configurations[0];
        assert!(summary.valid);
        assert_eq!(summary.name, "Go server");
        assert_eq!(summary.kind, "forge-go");
        assert_eq!(summary.request, "launch");
        assert!(summary.warnings.is_empty());
        assert!(
            serde_json::to_string(summary)
                .unwrap()
                .contains("Go server")
        );
        assert!(!serde_json::to_string(summary).unwrap().contains("PORT"));
        let resolved = loaded.resolved.get(&summary.id).unwrap();
        assert_eq!(
            resolved.program,
            root.join("main.go").canonicalize().unwrap()
        );
        assert_eq!(resolved.cwd, root.canonicalize().unwrap());
        assert_eq!(resolved.env["BAD=NAME"], "8080");
        assert_eq!(resolved.args, ["${env:PORT}"]);
        assert!(!resolved.stop_on_entry);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_non_json_and_paths_outside_the_workspace() {
        let root = workspace();
        let outside = root
            .parent()
            .unwrap()
            .join(format!("outside-{}.go", uuid::Uuid::new_v4()));
        std::fs::write(&outside, "package main").unwrap();
        let input = format!(
            r#"{{"configurations":[{{"name":"Escape","type":"forge-go","program":"{}"}}]}}"#,
            outside.display()
        );
        let workspace_id = "workspace-a".to_owned();
        let loader = ConfigurationLoader::new(&root, &workspace_id);
        assert!(loader.parse(input.as_bytes()).is_err());
        assert!(
            loader
                .parse(
                    br#"{"configurations": [ // JSONC is not supported
            ]}"#
                )
                .is_err()
        );
        assert!(loader.parse(br#"{"configurations": [],}"#).is_err());
        std::fs::remove_file(outside).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
