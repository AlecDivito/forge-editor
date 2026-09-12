//! Safe conversion of client-supplied paths to workspace-relative paths.

use std::path::{Component, Path, PathBuf};

/// Accept the legacy single leading slash used by clients, while rejecting
/// traversal, platform prefixes, and paths with a double-slash prefix.
///
/// An empty result is valid for callers that operate on a workspace root;
/// filesystem entry mutations must reject it separately.
pub fn normalize_workspace_relative(path: &Path) -> anyhow::Result<PathBuf> {
    if path.to_string_lossy().starts_with("//") {
        anyhow::bail!("path must remain beneath the workspace");
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => {
                if matches!(component, Component::RootDir) && normalized.as_os_str().is_empty() {
                    continue;
                }
                anyhow::bail!("path must remain beneath the workspace");
            }
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}
