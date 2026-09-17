use std::ffi::OsString;
use std::path::PathBuf;

/// PATH used for tools spawned by Forge. GUI/service launchers often provide a
/// much smaller PATH than an interactive shell, while Go installs binaries in
/// GOPATH/bin (or GOBIN) by default.
pub(crate) fn tool_path() -> OsString {
    let mut entries = Vec::<PathBuf>::new();

    if let Some(path) = std::env::var_os("PATH") {
        entries.extend(std::env::split_paths(&path));
    }

    if let Some(path) = std::env::var_os("GOBIN") {
        if !path.is_empty() {
            entries.push(PathBuf::from(path));
        }
    }

    if let Some(gopath) = std::env::var_os("GOPATH") {
        for root in std::env::split_paths(&gopath) {
            entries.push(root.join("bin"));
        }
    } else if let Some(home) = std::env::var_os("HOME") {
        entries.push(PathBuf::from(home).join("go/bin"));
    }

    // Keep the service-friendly defaults used by the debug adapters.
    for path in [
        "/usr/bin",
        "/bin",
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/opt/llvm/bin",
        "/usr/local/opt/llvm/bin",
    ] {
        entries.push(PathBuf::from(path));
    }

    let mut unique = Vec::with_capacity(entries.len());
    for entry in entries {
        if !unique.contains(&entry) {
            unique.push(entry);
        }
    }
    std::env::join_paths(unique).unwrap_or_default()
}

/// Environment values needed by Go and other toolchains after a child has
/// intentionally cleared its environment.
pub(crate) fn tool_environment() -> impl Iterator<Item = (&'static str, OsString)> {
    [
        "HOME",
        "GOCACHE",
        "GOPATH",
        "GOBIN",
        "GOMODCACHE",
        "GOROOT",
        "GOENV",
        "TMPDIR",
        "XDG_CACHE_HOME",
    ]
    .into_iter()
    .filter_map(|name| std::env::var_os(name).map(|value| (name, value)))
}
