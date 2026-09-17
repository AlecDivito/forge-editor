use super::StrategyRegistry;
use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

const MAX_CONFIG_BYTES: u64 = 256 * 1024;
const MAX_ARGS: usize = 128;
const MAX_ENV: usize = 64;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationList {
    pub revision: String,
    pub configurations: Vec<ConfigurationSummary>,
    pub diagnostics: Vec<DebugDiagnostic>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationSummary {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub request: String,
    pub valid: bool,
    pub warnings: Vec<String>,
    pub capabilities: PublicCapabilities,
}

#[derive(Debug, Clone, Default, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicCapabilities {
    pub integrated_terminal: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct DebugDiagnostic {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LaunchFile {
    version: String,
    configurations: Vec<RawConfiguration>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawConfiguration {
    name: String,
    #[serde(rename = "type")]
    kind: String,
    request: String,
    program: String,
    cwd: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    console: Option<String>,
    stop_on_entry: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ResolvedConfiguration {
    pub id: String,
    pub name: String,
    pub adapter_type: String,
    pub program: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub stop_on_entry: bool,
}

pub struct LoadedConfigurations {
    pub public: ConfigurationList,
    pub resolved: HashMap<String, ResolvedConfiguration>,
}

pub async fn load(
    root: &Path,
    workspace_id: &str,
    strategies: &StrategyRegistry,
) -> anyhow::Result<LoadedConfigurations> {
    let path = root.join(".vscode/launch.json");
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LoadedConfigurations {
                public: ConfigurationList {
                    revision: revision(b"missing"),
                    configurations: vec![],
                    diagnostics: vec![],
                },
                resolved: HashMap::new(),
            });
        }
        Err(error) => return Err(error.into()),
    };
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        anyhow::bail!("launch.json exceeds 256 KiB");
    }
    let rev = revision(&bytes);
    let text =
        std::str::from_utf8(&bytes).map_err(|_| anyhow::anyhow!("launch.json must be UTF-8"))?;
    let stripped = strip_jsonc(text)?;
    let file: LaunchFile = match serde_json::from_str(&stripped) {
        Ok(file) => file,
        Err(error) => {
            return Ok(LoadedConfigurations {
                public: ConfigurationList {
                    revision: rev,
                    configurations: vec![],
                    diagnostics: vec![DebugDiagnostic {
                        path: ".vscode/launch.json".into(),
                        message: error.to_string(),
                    }],
                },
                resolved: HashMap::new(),
            });
        }
    };
    let mut summaries = vec![];
    let mut resolved = HashMap::new();
    let mut names = HashSet::new();
    let version_ok = file.version == "0.2.0";
    for (index, raw) in file.configurations.into_iter().enumerate() {
        let normalized = raw.name.trim().to_lowercase();
        let id = stable_id(workspace_id, &normalized, &raw.kind);
        let mut errors = vec![];
        if !version_ok {
            errors.push("version must be 0.2.0".into());
        }
        if normalized.is_empty() {
            errors.push("name must not be empty".into());
        }
        if !names.insert(normalized) {
            errors.push("configuration names must be unique".into());
        }
        let strategy = strategies.get(&raw.kind);
        if strategy.is_none() {
            errors.push(format!(
                "unsupported debug type; expected one of: {}",
                strategies.supported_types().join(", ")
            ));
        }
        if raw.request != "launch" {
            errors.push("only request: launch is supported".into());
        }
        if raw.args.len() > MAX_ARGS {
            errors.push("args exceeds 128 entries".into());
        }
        if raw.env.len() > MAX_ENV {
            errors.push("env exceeds 64 entries".into());
        }
        if raw.console.as_deref().unwrap_or("internalConsole") != "internalConsole" {
            errors.push("debug adapters currently support internalConsole only".into());
        }
        let program = resolve_path(root, &raw.program)
            .map_err(|e| errors.push(format!("program: {e}")))
            .ok();
        let cwd = resolve_path(root, raw.cwd.as_deref().unwrap_or("${workspaceFolder}"))
            .map_err(|e| errors.push(format!("cwd: {e}")))
            .ok();
        for value in raw.args.iter().chain(raw.env.values()) {
            if value.contains("${") {
                errors.push("substitutions are supported only in program and cwd".into());
                break;
            }
            if value.len() > 8192 {
                errors.push("argument or environment value is too large".into());
                break;
            }
        }
        let valid = errors.is_empty();
        summaries.push(ConfigurationSummary {
            id: id.clone(),
            name: raw.name.clone(),
            kind: raw.kind.clone(),
            request: raw.request,
            valid,
            warnings: errors.clone(),
            capabilities: strategy
                .as_ref()
                .map(|strategy| strategy.capabilities())
                .unwrap_or_default(),
        });
        if valid {
            resolved.insert(
                id.clone(),
                ResolvedConfiguration {
                    id,
                    name: raw.name,
                    adapter_type: raw.kind,
                    program: program.unwrap(),
                    cwd: cwd.unwrap(),
                    args: raw.args,
                    env: raw.env,
                    stop_on_entry: raw.stop_on_entry.unwrap_or(false),
                },
            );
        }
        if errors.len() > 16 {
            summaries[index].warnings.truncate(16);
        }
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
    if value.contains("${command:") || value.contains("${env:") || value.contains("${config:") {
        anyhow::bail!("unsupported substitution");
    }
    let value = value.replace("${workspaceFolder}", root.to_string_lossy().as_ref());
    if value.contains("${") {
        anyhow::bail!("unsupported or incomplete substitution");
    }
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

fn stable_id(workspace: &str, name: &str, kind: &str) -> String {
    revision(format!("{workspace}\0{name}\0{kind}").as_bytes())
}
fn revision(bytes: &[u8]) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn strip_jsonc(input: &str) -> anyhow::Result<String> {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut string = false;
    let mut escaped = false;
    while let Some(c) = chars.next() {
        if string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                string = false;
            }
            continue;
        }
        if c == '"' {
            string = true;
            out.push(c);
            continue;
        }
        if c == '/' && chars.peek() == Some(&'/') {
            chars.next();
            for n in chars.by_ref() {
                if n == '\n' {
                    out.push('\n');
                    break;
                }
            }
            continue;
        }
        if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut closed = false;
            while let Some(n) = chars.next() {
                if n == '\n' {
                    out.push('\n');
                }
                if n == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    closed = true;
                    break;
                }
            }
            if !closed {
                anyhow::bail!("unterminated block comment");
            }
            continue;
        }
        out.push(c);
    }
    if string {
        anyhow::bail!("unterminated string");
    }
    // JSONC permits trailing commas. Remove them outside strings.
    let mut result = String::with_capacity(out.len());
    let mut iter = out.chars().peekable();
    let mut in_string = false;
    let mut escape = false;
    while let Some(c) = iter.next() {
        if in_string {
            result.push(c);
            if escape {
                escape = false
            } else if c == '\\' {
                escape = true
            } else if c == '"' {
                in_string = false
            };
            continue;
        }
        if c == '"' {
            in_string = true;
            result.push(c);
            continue;
        }
        if c == ',' {
            let mut look = iter.clone();
            while matches!(look.peek(), Some(x) if x.is_whitespace()) {
                look.next();
            }
            if matches!(look.peek(), Some(']') | Some('}')) {
                continue;
            }
        }
        result.push(c);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jsonc_comments_and_trailing_commas() {
        let value: serde_json::Value =
            serde_json::from_str(&strip_jsonc("{ // c\n \"a\": [1,], /* x */ }").unwrap()).unwrap();
        assert_eq!(value["a"][0], 1);
    }
}
