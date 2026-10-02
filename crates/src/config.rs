use std::{
    collections::HashSet,
    env,
    net::IpAddr,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, bail};
use axum::http::HeaderValue;
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
    /// The actual server-side context window. OpenAI-compatible discovery does
    /// not reliably expose this for local vLLM deployments, so it is explicit.
    pub max_context_tokens: u32,
    pub compaction_reserve_tokens: u32,
    pub compaction_keep_recent_tokens: u32,
    api_key: String,
}

#[derive(Clone)]
pub struct S3AttachmentConfig {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl std::fmt::Debug for S3AttachmentConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("S3AttachmentConfig")
            .field("endpoint", &self.endpoint)
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .field("access_key_id", &"[redacted]")
            .field("secret_access_key", &"[redacted]")
            .finish()
    }
}

impl std::fmt::Debug for OpenAiCompatibleConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OpenAiCompatibleConfig")
            .field("base_url", &self.base_url)
            .field("max_context_tokens", &self.max_context_tokens)
            .field("compaction_reserve_tokens", &self.compaction_reserve_tokens)
            .field(
                "compaction_keep_recent_tokens",
                &self.compaction_keep_recent_tokens,
            )
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
        Self {
            base_url,
            max_context_tokens: 32_768,
            compaction_reserve_tokens: 6_144,
            compaction_keep_recent_tokens: 12_288,
            api_key: "test-key".into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_address: IpAddr,
    pub cors_allowed_origin: HeaderValue,
    pub port: u16,
    pub environment: EnvironmentConfig,
    pub workspaces: Vec<WorkspaceConfig>,
    pub default_workspace_id: String,
    pub openai_compatible: Option<OpenAiCompatibleConfig>,
    pub s3_attachments: Option<S3AttachmentConfig>,
    pub agent_sessions_dir: PathBuf,
    pub agent_resources_dir: PathBuf,
    pub agent_attachment_cache_dir: PathBuf,
    pub agent_max_attachment_bytes: u64,
    pub agent_attachment_cache_max_bytes: u64,
    pub agent_max_model_rounds: u32,
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
        let bind_address = get("FORGE_BIND_ADDRESS")
            .unwrap_or_else(|| "127.0.0.1".into())
            .parse()
            .context("FORGE_BIND_ADDRESS must be a valid IP address")?;
        let cors_allowed_origin = get("FORGE_CORS_ALLOWED_ORIGIN")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "http://localhost:3000".into());
        let cors_allowed_origin = HeaderValue::from_str(&cors_allowed_origin)
            .context("FORGE_CORS_ALLOWED_ORIGIN must be a valid HTTP header value")?;
        let port = get("PORT")
            .unwrap_or_else(|| "8080".into())
            .parse()
            .context("PORT must be a valid TCP port")?;
        let max_context_tokens = positive_u32(&get, "FORGE_AGENT_MAX_CONTEXT_TOKENS", 32_768)?;
        let compaction_reserve_tokens =
            positive_u32(&get, "FORGE_AGENT_COMPACTION_RESERVE_TOKENS", 6_144)?;
        let compaction_keep_recent_tokens =
            positive_u32(&get, "FORGE_AGENT_COMPACTION_KEEP_RECENT_TOKENS", 12_288)?;
        if compaction_reserve_tokens.saturating_add(compaction_keep_recent_tokens)
            >= max_context_tokens
        {
            bail!(
                "FORGE_AGENT_COMPACTION_RESERVE_TOKENS plus FORGE_AGENT_COMPACTION_KEEP_RECENT_TOKENS must be less than FORGE_AGENT_MAX_CONTEXT_TOKENS"
            );
        }
        let openai_compatible = match (
            get("OPENAI_API_BASE_URL").filter(|value| !value.trim().is_empty()),
            get("OPENAI_API_KEY").filter(|value| !value.trim().is_empty()),
        ) {
            (Some(base_url), Some(api_key)) => Some(OpenAiCompatibleConfig {
                base_url,
                max_context_tokens,
                compaction_reserve_tokens,
                compaction_keep_recent_tokens,
                api_key,
            }),
            (Some(_), None) | (None, Some(_)) => {
                tracing::warn!(
                    "OPENAI_API_BASE_URL and OPENAI_API_KEY must both be set; the model provider is disabled"
                );
                None
            }
            (None, None) => None,
        };
        let s3_attachments = match (
            get("FORGE_S3_ENDPOINT").filter(|value| !value.trim().is_empty()),
            get("FORGE_S3_BUCKET").filter(|value| !value.trim().is_empty()),
            get("FORGE_S3_ACCESS_KEY_ID").filter(|value| !value.trim().is_empty()),
            get("FORGE_S3_SECRET_ACCESS_KEY").filter(|value| !value.trim().is_empty()),
            get("FORGE_S3_REGION").filter(|value| !value.trim().is_empty()),
        ) {
            (
                Some(endpoint),
                Some(bucket),
                Some(access_key_id),
                Some(secret_access_key),
                Some(region),
            ) => Some(S3AttachmentConfig {
                endpoint,
                bucket,
                region,
                access_key_id,
                secret_access_key,
            }),
            (None, None, None, None, None) => None,
            _ => {
                tracing::warn!(
                    "FORGE_S3_ENDPOINT, FORGE_S3_BUCKET, FORGE_S3_ACCESS_KEY_ID, FORGE_S3_REGION, and FORGE_S3_SECRET_ACCESS_KEY must all be set; image attachments are disabled"
                );
                None
            }
        };
        let agent_sessions_dir = get("FORGE_AGENT_SESSIONS_DIR")
            .filter(|value| !value.trim().is_empty())
            .context("FORGE_AGENT_SESSIONS_DIR is required for AI session storage")?;
        let agent_sessions_dir =
            canonical_directory(Path::new(&agent_sessions_dir), "FORGE_AGENT_SESSIONS_DIR")?;
        let agent_resources_dir =
            match get("FORGE_AGENT_RESOURCES_DIR").filter(|value| !value.trim().is_empty()) {
                Some(path) => {
                    let path = PathBuf::from(path);
                    if !path.is_absolute() {
                        bail!("FORGE_AGENT_RESOURCES_DIR must be an absolute path");
                    }
                    path
                }
                // Resources are authored files, not existing state that must be
                // restored. Bootstrap a local directory now; a future sync layer
                // can populate this same root from object storage.
                None => agent_sessions_dir.join("resources"),
            };
        let agent_attachment_cache_dir = match get("FORGE_AGENT_ATTACHMENT_CACHE_DIR")
            .filter(|value| !value.trim().is_empty())
        {
            Some(path) => {
                let path = PathBuf::from(path);
                if !path.is_absolute() {
                    bail!("FORGE_AGENT_ATTACHMENT_CACHE_DIR must be an absolute path");
                }
                path
            }
            None => agent_sessions_dir.join("attachment-cache"),
        };
        let agent_max_attachment_bytes = get("FORGE_AGENT_MAX_ATTACHMENT_BYTES")
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                value
                    .parse::<u64>()
                    .context("FORGE_AGENT_MAX_ATTACHMENT_BYTES must be a positive integer")
            })
            .transpose()?
            .unwrap_or(20 * 1024 * 1024);
        if agent_max_attachment_bytes == 0 {
            bail!("FORGE_AGENT_MAX_ATTACHMENT_BYTES must be greater than zero");
        }
        let agent_attachment_cache_max_bytes = get("FORGE_AGENT_ATTACHMENT_CACHE_MAX_BYTES")
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                value
                    .parse::<u64>()
                    .context("FORGE_AGENT_ATTACHMENT_CACHE_MAX_BYTES must be a positive integer")
            })
            .transpose()?
            .unwrap_or_else(|| agent_max_attachment_bytes.saturating_mul(5));
        if agent_attachment_cache_max_bytes == 0 {
            bail!("FORGE_AGENT_ATTACHMENT_CACHE_MAX_BYTES must be greater than zero");
        }
        let agent_max_model_rounds = get("FORGE_AGENT_MAX_MODEL_ROUNDS")
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                value
                    .parse::<u32>()
                    .context("FORGE_AGENT_MAX_MODEL_ROUNDS must be a positive integer")
            })
            .transpose()?
            .unwrap_or(16);
        if agent_max_model_rounds == 0 {
            bail!("FORGE_AGENT_MAX_MODEL_ROUNDS must be greater than zero");
        }

        let Some(json) = get("FORGE_WORKSPACES_JSON") else {
            let base = get("BASE_DIRECTORY").context(
                "FORGE_WORKSPACES_JSON and FORGE_WORKSPACES_ROOT are required (BASE_DIRECTORY is temporarily supported for migration)",
            )?;
            tracing::warn!("BASE_DIRECTORY is deprecated; configure FORGE_WORKSPACES_JSON instead");
            return Ok(Self {
                bind_address,
                cors_allowed_origin,
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
                s3_attachments,
                agent_sessions_dir,
                agent_resources_dir,
                agent_attachment_cache_dir,
                agent_max_attachment_bytes,
                agent_attachment_cache_max_bytes,
                agent_max_model_rounds,
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
            bind_address,
            cors_allowed_origin,
            port,
            environment,
            workspaces,
            default_workspace_id,
            openai_compatible,
            s3_attachments,
            agent_sessions_dir,
            agent_resources_dir,
            agent_attachment_cache_dir,
            agent_max_attachment_bytes,
            agent_attachment_cache_max_bytes,
            agent_max_model_rounds,
        })
    }
}

fn positive_u32(
    get: &impl Fn(&str) -> Option<String>,
    key: &str,
    default: u32,
) -> anyhow::Result<u32> {
    let value = get(key)
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            value
                .parse::<u32>()
                .with_context(|| format!("{key} must be a positive integer"))
        })
        .transpose()?
        .unwrap_or(default);
    if value == 0 {
        bail!("{key} must be greater than zero");
    }
    Ok(value)
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
        values
            .entry("FORGE_AGENT_RESOURCES_DIR")
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
    fn parses_network_settings_with_safe_defaults() {
        let root = root();
        let base = HashMap::from([
            ("FORGE_WORKSPACES_ROOT", root.to_string_lossy().into_owned()),
            (
                "FORGE_WORKSPACES_JSON",
                r#"[{"id":"one","name":"One","path":"one"}]"#.into(),
            ),
        ]);
        assert_eq!(
            parse(base.clone()).unwrap().bind_address,
            "127.0.0.1".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            parse(base.clone()).unwrap().cors_allowed_origin,
            HeaderValue::from_static("http://localhost:3000")
        );

        let mut externally_reachable = base;
        externally_reachable.insert("FORGE_BIND_ADDRESS", "0.0.0.0".into());
        externally_reachable.insert(
            "FORGE_CORS_ALLOWED_ORIGIN",
            "https://forge.example.com".into(),
        );
        assert_eq!(
            parse(externally_reachable.clone()).unwrap().bind_address,
            "0.0.0.0".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            parse(externally_reachable).unwrap().cors_allowed_origin,
            HeaderValue::from_static("https://forge.example.com")
        );

        assert!(
            parse(HashMap::from([
                ("FORGE_WORKSPACES_ROOT", root.to_string_lossy().into_owned()),
                (
                    "FORGE_WORKSPACES_JSON",
                    r#"[{"id":"one","name":"One","path":"one"}]"#.into(),
                ),
                (
                    "FORGE_CORS_ALLOWED_ORIGIN",
                    "https://forge.example.com\ninvalid".into(),
                ),
            ]))
            .is_err()
        );

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

    #[test]
    fn configures_agent_model_round_limit() {
        let root = root();
        let config = parse(HashMap::from([
            ("FORGE_WORKSPACES_ROOT", root.to_string_lossy().into_owned()),
            (
                "FORGE_WORKSPACES_JSON",
                r#"[{"id":"one","name":"One","path":"one"}]"#.into(),
            ),
            ("FORGE_AGENT_MAX_MODEL_ROUNDS", "24".into()),
        ]))
        .unwrap();
        assert_eq!(config.agent_max_model_rounds, 24);
        assert!(
            parse(HashMap::from([
                ("FORGE_WORKSPACES_ROOT", root.to_string_lossy().into_owned()),
                (
                    "FORGE_WORKSPACES_JSON",
                    r#"[{"id":"one","name":"One","path":"one"}]"#.into()
                ),
                ("FORGE_AGENT_MAX_MODEL_ROUNDS", "0".into()),
            ]))
            .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
