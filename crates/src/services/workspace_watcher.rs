use std::{
    path::Path,
    time::{Duration, Instant},
};

use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{ModifyKind, RenameMode},
};
use tracing::{info, warn};

use crate::{
    models::{FsEntryType, ServerMessage},
    state::AppState,
};

/// Starts one native recursive watcher per configured workspace. The returned
/// handles own the subscriptions and must be retained for the server lifetime.
pub fn start(state: AppState) -> anyhow::Result<Vec<RecommendedWatcher>> {
    let mut watchers = Vec::new();

    for workspace in &state.config.workspaces {
        let workspace_id = workspace.id.clone();
        let root = workspace.root.clone();
        let callback_state = state.clone();
        let callback_root = root.clone();
        let callback_workspace_id = workspace_id.clone();
        let mut rename_pairer = RenamePairer::default();
        let mut watcher = RecommendedWatcher::new(
            move |result: notify::Result<Event>| match result {
                Ok(event) if is_tree_change(&event.kind) => {
                    let paths = event
                        .paths
                        .iter()
                        .filter_map(|path| relative_file_id(&callback_root, path))
                        .collect::<Vec<_>>();
                    if paths.is_empty() {
                        return;
                    }

                    // notify preserves both sides of an atomic rename on its
                    // native backends. Route that through the authoritative
                    // rename event so open documents, tabs, diagnostics and
                    // pending saves all move with the file.
                    let rename = if is_complete_rename(&event.kind) && paths.len() >= 2 {
                        Some((paths[0].clone(), paths[1].clone()))
                    } else if matches!(
                        event.kind,
                        EventKind::Modify(ModifyKind::Name(RenameMode::Any))
                    ) {
                        paths.first().and_then(|path| {
                            rename_pairer.observe(
                                path.clone(),
                                event.paths.first().is_some_and(|path| path.exists()),
                            )
                        })
                    } else {
                        None
                    };
                    if let Some((from, to)) = rename {
                        let destination = callback_root.join(to.trim_start_matches('/'));
                        broadcast(
                            &callback_state,
                            &callback_workspace_id,
                            ServerMessage::FsRenamed {
                                workspace_id: callback_workspace_id.clone(),
                                from,
                                to,
                                entry_type: entry_type(Some(&destination)),
                            },
                        );
                    }
                    broadcast(
                        &callback_state,
                        &callback_workspace_id,
                        ServerMessage::FsChanged {
                            workspace_id: callback_workspace_id.clone(),
                            paths,
                        },
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    warn!(workspace_id = %callback_workspace_id, %error, "filesystem watcher error")
                }
            },
            Config::default().with_poll_interval(Duration::from_secs(2)),
        )?;
        watcher.watch(&root, RecursiveMode::Recursive)?;
        info!(workspace_id = %workspace_id, root = %root.display(), "watching workspace filesystem");
        watchers.push(watcher);
    }

    Ok(watchers)
}

#[derive(Default)]
struct RenamePairer {
    pending: Vec<(Instant, String, bool)>,
}

impl RenamePairer {
    /// FSEvents emits two RenameMode::Any events and provides no cookie. Pair
    /// a recently disappeared path with a recently appeared path. Entries are
    /// short-lived to avoid correlating unrelated operations.
    fn observe(&mut self, path: String, exists: bool) -> Option<(String, String)> {
        let now = Instant::now();
        self.pending
            .retain(|(seen, _, _)| now.duration_since(*seen) < Duration::from_secs(2));
        if let Some(index) = self
            .pending
            .iter()
            .position(|(_, _, other_exists)| *other_exists != exists)
        {
            let (_, other, other_exists) = self.pending.remove(index);
            return Some(if exists && !other_exists {
                (other, path)
            } else {
                (path, other)
            });
        }
        self.pending.push((now, path, exists));
        None
    }
}

fn broadcast(state: &AppState, workspace_id: &str, message: ServerMessage) {
    for client in state.clients.iter() {
        if let Err(error) = client.value().document_tx.try_send(message.clone()) {
            warn!(%workspace_id, %error, "dropping filesystem watcher event");
        }
    }
}

fn is_complete_rename(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::Both))
            | EventKind::Modify(ModifyKind::Name(RenameMode::Any))
    )
}

fn entry_type(path: Option<&std::path::PathBuf>) -> FsEntryType {
    match path.and_then(|path| std::fs::symlink_metadata(path).ok()) {
        Some(metadata) if metadata.file_type().is_dir() => FsEntryType::Directory,
        Some(metadata) if metadata.file_type().is_symlink() => FsEntryType::Symlink,
        _ => FsEntryType::File,
    }
}

fn is_tree_change(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Other
    )
}

fn relative_file_id(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    Some(format!(
        "/{}",
        relative.to_string_lossy().replace('\\', "/")
    ))
}

#[cfg(test)]
mod tests {
    use super::{RenamePairer, is_complete_rename, relative_file_id};
    use notify::{
        EventKind,
        event::{ModifyKind, RenameMode},
    };
    use std::path::Path;

    #[test]
    fn watcher_paths_use_workspace_file_ids() {
        assert_eq!(
            relative_file_id(Path::new("/repo"), Path::new("/repo/src/main.rs")),
            Some("/src/main.rs".into())
        );
        assert_eq!(
            relative_file_id(Path::new("/repo"), Path::new("/other/file")),
            None
        );
    }

    #[test]
    fn only_complete_native_renames_are_remapped() {
        assert!(is_complete_rename(&EventKind::Modify(ModifyKind::Name(
            RenameMode::Both
        ))));
        assert!(is_complete_rename(&EventKind::Modify(ModifyKind::Name(
            RenameMode::Any
        ))));
        assert!(!is_complete_rename(&EventKind::Modify(ModifyKind::Name(
            RenameMode::From
        ))));
        assert!(!is_complete_rename(&EventKind::Modify(ModifyKind::Name(
            RenameMode::To
        ))));
    }

    #[test]
    fn unpaired_fsevents_renames_are_correlated_by_path_existence() {
        let mut pairer = RenamePairer::default();
        assert_eq!(pairer.observe("/old".into(), false), None);
        assert_eq!(
            pairer.observe("/new".into(), true),
            Some(("/old".into(), "/new".into()))
        );

        let mut reverse = RenamePairer::default();
        assert_eq!(reverse.observe("/new".into(), true), None);
        assert_eq!(
            reverse.observe("/old".into(), false),
            Some(("/old".into(), "/new".into()))
        );
    }
}
