use std::{
    collections::HashSet,
    env,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, bail};
use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentConfig {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceConfig {
    pub id: String,
    pub name: String,
    pub root: PathBuf,
}

#[derive(Clone)]
pub struct OpenAiCompatibleConfig {
    pub base_url: String,
    api_key: String,
}

impl std::fmt::Debug for OpenAiCompatibleConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OpenAiCompatibleConfig")
            .field("base_url", &self.base_url)
            .field("api_key", &"[redacted]")
            .finish()
    }
}

impl OpenAiCompatibleConfig {
    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    #[cfg(test)]
    pub(crate) fn for_test(base_url: String) -> Self {
        Self { base_url, api_key: "test-key".into() }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub environment: EnvironmentConfig,
    pub workspaces: Vec<WorkspaceConfig>,
    pub default_workspace_id: String,
    pub openai_compatible: Option<OpenAiCompatibleConfig>,
    pub agent_sessions_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
struct RawWorkspace {
    id: String,
    name: String,
    path: PathBuf,
}

impl Config {
    pub fn new() -> Result<Self, anyhow::Error> {
        Self::from_values(|key| env::var(key).ok())
    }

    fn from_values(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let port = get("PORT")
            .unwrap_or_else(|| "8080".into())
            .parse()
            .context("PORT must be a valid TCP port")?;
        let openai_compatible = match (
            get("OPENAI_API_BASE_URL").filter(|value| !value.trim().is_empty()),
            get("OPENAI_API_KEY").filter(|value| !value.trim().is_empty()),
        ) {
            (Some(base_url), Some(api_key)) => Some(OpenAiCompatibleConfig { base_url, api_key }),
            (Some(_), None) | (None, Some(_)) => {
                tracing::warn!(
                    "OPENAI_API_BASE_URL and OPENAI_API_KEY must both be set; the model provider is disabled"
                );
                None
            }
            (None, None) => None,
        };
        let agent_sessions_dir = get("FORGE_AGENT_SESSIONS_DIR")
            .filter(|value| !value.trim().is_empty())
            .context("FORGE_AGENT_SESSIONS_DIR is required for AI session storage")?;
        let agent_sessions_dir =
            canonical_directory(Path::new(&agent_sessions_dir), "FORGE_AGENT_SESSIONS_DIR")?;

        let Some(json) = get("FORGE_WORKSPACES_JSON") else {
            let base = get("BASE_DIRECTORY").context(
                "FORGE_WORKSPACES_JSON and FORGE_WORKSPACES_ROOT are required (BASE_DIRECTORY is temporarily supported for migration)",
            )?;
            tracing::warn!("BASE_DIRECTORY is deprecated; configure FORGE_WORKSPACES_JSON instead");
            return Ok(Self {
                port,
                environment: EnvironmentConfig {
                    id: "local".into(),
                    name: "Local projects".into(),
                },
                workspaces: vec![WorkspaceConfig {
                    id: "default".into(),
                    name: "Default workspace".into(),
                    root: canonical_directory(Path::new(&base), "BASE_DIRECTORY")?,
                }],
                default_workspace_id: "default".into(),
                openai_compatible,
                agent_sessions_dir,
            });
        };

        let environment = EnvironmentConfig {
            id: validate_id(
                "FORGE_ENVIRONMENT_ID",
                get("FORGE_ENVIRONMENT_ID").as_deref().unwrap_or("local"),
            )?,
            name: nonempty(
                "FORGE_ENVIRONMENT_NAME",
                get("FORGE_ENVIRONMENT_NAME").as_deref().unwrap_or("Forge"),
            )?,
        };
        let parent = get("FORGE_WORKSPACES_ROOT").context("FORGE_WORKSPACES_ROOT is required")?;
        let parent = canonical_directory(Path::new(&parent), "FORGE_WORKSPACES_ROOT")?;
        let raw: Vec<RawWorkspace> = serde_json::from_str(&json)
            .context("FORGE_WORKSPACES_JSON must be a JSON array of {id,name,path}")?;
        if raw.is_empty() {
            bail!("FORGE_WORKSPACES_JSON must contain at least one workspace");
        }

        let mut ids = HashSet::new();
        let mut roots = HashSet::new();
        let mut workspaces = Vec::with_capacity(raw.len());
        for item in raw {
            let id = validate_id("workspace id", &item.id)?;
            if !ids.insert(id.clone()) {
                bail!("duplicate workspace id: {id}");
            }
            validate_relative_path(&item.path)?;
            let root = canonical_directory(&parent.join(&item.path), &format!("workspace {id}"))?;
            if !root.starts_with(&parent) {
                bail!("workspace {id} resolves outside FORGE_WORKSPACES_ROOT");
            }
            if !roots.insert(root.clone()) {
                bail!("multiple workspaces resolve to the same directory");
            }
            workspaces.push(WorkspaceConfig {
                id,
                name: nonempty("workspace name", &item.name)?,
                root,
            });
        }
        for (index, left) in workspaces.iter().enumerate() {
            for right in workspaces.iter().skip(index + 1) {
                if left.root.starts_with(&right.root) || right.root.starts_with(&left.root) {
                    bail!("workspace roots overlap: {} and {}", left.id, right.id);
                }
            }
        }
        let default_workspace_id = match get("FORGE_DEFAULT_WORKSPACE") {
            Some(id) if ids.contains(&id) => id,
            Some(id) => bail!("FORGE_DEFAULT_WORKSPACE references unknown workspace: {id}"),
            None if workspaces.len() == 1 => workspaces[0].id.clone(),
            None => {
                bail!("FORGE_DEFAULT_WORKSPACE is required when multiple workspaces are configured")
            }
        };
        Ok(Self {
            port,
            environment,
            workspaces,
            default_workspace_id,
            openai_compatible,
            agent_sessions_dir,
        })
    }
}

fn validate_id(label: &str, value: &str) -> anyhow::Result<String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        bail!("{label} must be 1-128 URL-safe letters, numbers, '-' or '_'");
    }
    Ok(value.to_owned())
}

fn nonempty(label: &str, value: &str) -> anyhow::Result<String> {
    let value = value.trim();
    if value.is_empty() {
        bail!("{label} must not be empty");
    }
    Ok(value.to_owned())
}

fn validate_relative_path(path: &Path) -> anyhow::Result<()> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        bail!(
            "workspace path must be a non-empty relative path without traversal: {}",
            path.display()
        );
    }
    Ok(())
}

fn canonical_directory(path: &Path, label: &str) -> anyhow::Result<PathBuf> {
    let root = path
        .canonicalize()
        .with_context(|| format!("{label} does not exist: {}", path.display()))?;
    if !root.is_dir() {
        bail!("{label} is not a directory: {}", path.display());
    }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn root() -> PathBuf {
        let root = env::temp_dir().join(format!(
            "forge-config-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("one")).unwrap();
        std::fs::create_dir_all(root.join("two")).unwrap();
        root
    }

    fn parse(values: HashMap<&str, String>) -> anyhow::Result<Config> {
        let mut values = values;
        values
            .entry("FORGE_AGENT_SESSIONS_DIR")
            .or_insert_with(|| env::temp_dir().display().to_string());
        Config::from_values(|key| values.get(key).cloned())
    }

    #[test]
    fn parses_multiple_workspaces_and_requires_valid_default() {
        let root = root();
        let values = HashMap::from([
            ("FORGE_WORKSPACES_ROOT", root.to_string_lossy().into_owned()),
            ("FORGE_WORKSPACES_JSON", r#"[{"id":"one","name":"One","path":"one"},{"id":"two","name":"Two","path":"two"}]"#.into()),
            ("FORGE_DEFAULT_WORKSPACE", "two".into()),
        ]);
        let config = parse(values).unwrap();
        assert_eq!(config.default_workspace_id, "two");
        assert_eq!(config.workspaces.len(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_traversal_duplicate_ids_and_missing_multi_default() {
        let root = root();
        for json in [
            r#"[{"id":"one","name":"One","path":"../one"}]"#,
            r#"[{"id":"one","name":"One","path":"one"},{"id":"one","name":"Two","path":"two"}]"#,
        ] {
            assert!(
                parse(HashMap::from([
                    ("FORGE_WORKSPACES_ROOT", root.to_string_lossy().into_owned()),
                    ("FORGE_WORKSPACES_JSON", json.into()),
                ]))
                .is_err()
            );
        }
        assert!(parse(HashMap::from([
            ("FORGE_WORKSPACES_ROOT", root.to_string_lossy().into_owned()),
            ("FORGE_WORKSPACES_JSON", r#"[{"id":"one","name":"One","path":"one"},{"id":"two","name":"Two","path":"two"}]"#.into()),
        ])).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
