use std::{path::Path, process::Stdio, time::Duration};

use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

use crate::models::{GitChange, GitDiff, GitStatus};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT: usize = 8 * 1024 * 1024;

async fn run(root: &Path, args: &[&str], stdin: Option<&[u8]>) -> anyhow::Result<Vec<u8>> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("GIT_EDITOR", "true")
        // Read-only commands such as status must not refresh the index and
        // wake the filesystem watcher, which would create a refetch loop.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if stdin.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }
    let mut child = command.spawn()?;
    if let Some(input) = stdin {
        child.stdin.take().unwrap().write_all(input).await?;
    }
    let output = timeout(COMMAND_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| anyhow::anyhow!("Git command timed out"))??;
    if output.stdout.len() > MAX_OUTPUT || output.stderr.len() > MAX_OUTPUT {
        anyhow::bail!("Git command output was too large");
    }
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        anyhow::bail!(if message.is_empty() {
            "Git command failed".into()
        } else {
            message
        });
    }
    Ok(output.stdout)
}

fn file_id(path: &str) -> anyhow::Result<String> {
    if path.is_empty() || path.starts_with('/') || path.contains('\0') {
        anyhow::bail!("invalid Git path");
    }
    let normalized = crate::utils::workspace_path::normalize_workspace_relative(Path::new(path))?;
    Ok(format!(
        "/{}",
        normalized.to_string_lossy().replace('\\', "/")
    ))
}

fn path_arg(path: &str) -> anyhow::Result<String> {
    let normalized = crate::utils::workspace_path::normalize_workspace_relative(Path::new(path))?;
    Ok(normalized.to_string_lossy().replace('\\', "/"))
}

async fn optional_text(root: &Path, args: &[&str]) -> Option<String> {
    run(root, args, None).await.ok().and_then(|bytes| {
        let value = String::from_utf8(bytes).ok()?.trim().to_string();
        (!value.is_empty()).then_some(value)
    })
}

async fn optional_blob(root: &Path, args: &[&str]) -> Option<String> {
    String::from_utf8(run(root, args, None).await.ok()?).ok()
}

pub async fn status(
    root: &Path,
    workspace_id: String,
    generation: u64,
    identity_configured: bool,
) -> anyhow::Result<GitStatus> {
    let top = optional_text(root, &["rev-parse", "--show-toplevel"])
        .await
        .ok_or_else(|| anyhow::anyhow!("Workspace is not a Git repository"))?;
    if Path::new(&top).canonicalize()? != root.canonicalize()? {
        anyhow::bail!("Git repository root must match the workspace root");
    }
    let output = run(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        None,
    )
    .await?;
    let records = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    let mut changes = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = std::str::from_utf8(records[index])
            .map_err(|_| anyhow::anyhow!("non-UTF-8 Git paths are unsupported"))?;
        if record.len() < 4 {
            anyhow::bail!("malformed Git status record");
        }
        let bytes = record.as_bytes();
        let x = bytes[0] as char;
        let y = bytes[1] as char;
        let path = file_id(&record[3..])?;
        let mut original_path = None;
        if x == 'R' || x == 'C' {
            index += 1;
            let original = records
                .get(index)
                .ok_or_else(|| anyhow::anyhow!("malformed Git rename record"))?;
            original_path =
                Some(file_id(std::str::from_utf8(original).map_err(|_| {
                    anyhow::anyhow!("non-UTF-8 Git paths are unsupported")
                })?)?);
        }
        let conflicted = matches!(
            (x, y),
            ('D', 'D')
                | ('A', 'U')
                | ('U', 'D')
                | ('U', 'A')
                | ('D', 'U')
                | ('A', 'A')
                | ('U', 'U')
        );
        changes.push(GitChange {
            path,
            original_path,
            index_status: (x != ' ' && x != '?').then(|| x.to_string()),
            worktree_status: (y != ' ').then(|| {
                if x == '?' && y == '?' {
                    "?".into()
                } else {
                    y.to_string()
                }
            }),
            conflicted,
        });
        index += 1;
    }
    let branch = optional_text(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await;
    let can_push = optional_text(
        root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .await
    .is_some();
    Ok(GitStatus {
        workspace_id,
        generation,
        detached: branch.is_none(),
        branch,
        identity_configured,
        can_push,
        changes,
    })
}

pub async fn diff(
    root: &Path,
    workspace_id: String,
    generation: u64,
    path: &str,
    view: &str,
) -> anyhow::Result<GitDiff> {
    let relative = path_arg(path)?;
    let spec_index = format!(":{relative}");
    let spec_head = format!("HEAD:{relative}");
    let before = if view == "staged" {
        optional_blob(root, &["show", "--no-ext-diff", &spec_head])
            .await
            .unwrap_or_default()
    } else {
        optional_blob(root, &["show", "--no-ext-diff", &spec_index])
            .await
            .or_else(|| None)
            .unwrap_or_default()
    };
    let after = if view == "staged" {
        optional_blob(root, &["show", "--no-ext-diff", &spec_index])
            .await
            .unwrap_or_default()
    } else {
        tokio::fs::read_to_string(root.join(&relative))
            .await
            .unwrap_or_default()
    };
    Ok(GitDiff {
        workspace_id,
        generation,
        path: file_id(&relative)?,
        view: view.into(),
        before,
        after,
    })
}

pub async fn stage(root: &Path, paths: &[String]) -> anyhow::Result<()> {
    let args = paths
        .iter()
        .map(|path| path_arg(path))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let mut refs = vec!["add", "--all", "--"];
    refs.extend(args.iter().map(String::as_str));
    run(root, &refs, None).await.map(|_| ())
}

pub async fn unstage(root: &Path, paths: &[String]) -> anyhow::Result<()> {
    let args = paths
        .iter()
        .map(|path| path_arg(path))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let unborn = run(root, &["rev-parse", "--verify", "HEAD"], None)
        .await
        .is_err();
    let mut refs = if unborn {
        vec!["rm", "--cached", "--ignore-unmatch", "--"]
    } else {
        vec!["reset", "--quiet", "HEAD", "--"]
    };
    refs.extend(args.iter().map(String::as_str));
    run(root, &refs, None).await.map(|_| ())
}

pub async fn commit(root: &Path, message: &str) -> anyhow::Result<String> {
    if message.trim().is_empty() || message.len() > 16_384 {
        anyhow::bail!("Commit message is required and must be at most 16384 bytes");
    }
    run(
        root,
        &[
            "-c",
            "commit.gpgSign=false",
            "commit",
            "--no-verify",
            "-F",
            "-",
        ],
        Some(message.as_bytes()),
    )
    .await?;
    optional_text(root, &["rev-parse", "HEAD"])
        .await
        .ok_or_else(|| anyhow::anyhow!("Commit succeeded but HEAD could not be read"))
}

pub async fn push(root: &Path) -> anyhow::Result<()> {
    run(root, &["push", "--porcelain"], None).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(root: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn repository() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "forge-git-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        command(&root, &["init", "-q"]);
        command(&root, &["config", "user.name", "Forge Test"]);
        command(&root, &["config", "user.email", "forge@example.invalid"]);
        root
    }

    #[tokio::test]
    async fn status_diff_stage_unstage_and_commit_use_native_repository() {
        let root = repository();
        std::fs::write(root.join("hello.txt"), "before\n").unwrap();
        command(&root, &["add", "hello.txt"]);
        command(&root, &["commit", "-qm", "initial"]);
        std::fs::write(root.join("hello.txt"), "after\n").unwrap();

        let initial = status(&root, "workspace".into(), 1, true).await.unwrap();
        assert_eq!(initial.changes.len(), 1);
        assert_eq!(initial.changes[0].worktree_status.as_deref(), Some("M"));
        let working = diff(&root, "workspace".into(), 1, "/hello.txt", "working")
            .await
            .unwrap();
        assert_eq!(working.before, "before\n");
        assert_eq!(working.after, "after\n");

        stage(&root, &["/hello.txt".into()]).await.unwrap();
        let staged = status(&root, "workspace".into(), 2, true).await.unwrap();
        assert_eq!(staged.changes[0].index_status.as_deref(), Some("M"));
        let staged_diff = diff(&root, "workspace".into(), 2, "/hello.txt", "staged")
            .await
            .unwrap();
        assert_eq!(staged_diff.before, "before\n");
        assert_eq!(staged_diff.after, "after\n");

        unstage(&root, &["/hello.txt".into()]).await.unwrap();
        stage(&root, &["/hello.txt".into()]).await.unwrap();
        let sha = commit(&root, "update hello").await.unwrap();
        assert_eq!(sha.len(), 40);
        assert!(
            status(&root, "workspace".into(), 3, true)
                .await
                .unwrap()
                .changes
                .is_empty()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn path_arguments_reject_escape_and_normalize_file_ids() {
        assert!(path_arg("../outside").is_err());
        assert_eq!(path_arg("/src/main.rs").unwrap(), "src/main.rs");
        assert_eq!(path_arg("src/main.rs").unwrap(), "src/main.rs");
    }
}
