use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use rovo::{axum::IntoApiResponse, rovo};
use tracing::debug;

use crate::{
    error::AppError,
    models::{
        FileNameSearchQuery, FileNameSearchResponse, FileNameSearchResult, FsFile,
        FsSearchHttpQuery, FsSearchQuery, FsSearchResult, SearchCancellation, SearchWorkspaceQuery,
    },
    state::AppState,
    utils::file_search::{
        apply_case_pattern, build_glob_set, ensure_searchable_workspace, fuzzy_score, match_file,
        matches_exclude, matches_include, relative_file_id, truncate_results,
    },
};

use crate::models::FsSearchResponse;

/// Fuzzy-search file names and relative paths in the workspace.
///
/// This is deliberately separate from `search_files`: that endpoint searches
/// file contents, while the command palette needs cheap file candidates as the
/// user types.
///
/// # Responses
///
/// 200: Json<FileNameSearchResponse> - Successfully searched file names
/// 400: () - Failed to search file names
///
/// # Metadata
///
/// @tag fs
#[rovo]
pub async fn search_file_names(
    State(state): State<AppState>,
    Query(query): Query<FileNameSearchQuery>,
) -> impl IntoApiResponse {
    search_file_names_impl(state, query).await.into_response()
}

async fn search_file_names_impl(
    state: AppState,
    query: FileNameSearchQuery,
) -> Result<impl IntoResponse, AppError> {
    let workspaces = workspace_roots(&state, query.workspace_id.as_deref())?;
    let mut cancellation = SearchCancellation::new();
    let cancelled = cancellation.flag();
    let response = tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        for (workspace_id, root) in workspaces {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            results.extend(search_file_names_blocking(
                &workspace_id,
                &root,
                &query,
                &cancelled,
            )?);
        }
        results.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.path.cmp(&b.1.path)));
        let truncated = truncate_results(&mut results, query.max_results);
        Ok::<_, AppError>(FileNameSearchResponse {
            results: results.into_iter().map(|(_, file)| file).collect(),
            truncated,
        })
    })
    .await
    .map_err(|err| AppError::String(format!("file search task failed: {err}")))??;
    cancellation.disarm();
    Ok(Json(response))
}

fn search_file_names_blocking(
    workspace_id: &str,
    base_dir: &Path,
    query: &FileNameSearchQuery,
    cancelled: &AtomicBool,
) -> Result<Vec<(usize, FileNameSearchResult)>, AppError> {
    ensure_searchable_workspace(base_dir)?;
    let normalized_query = query.search.trim().to_lowercase();
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let walker = ignore::WalkBuilder::new(base_dir)
        .hidden(false)
        .ignore(query.use_ignore_files)
        .git_ignore(query.use_ignore_files)
        .git_global(query.use_ignore_files)
        .git_exclude(query.use_ignore_files)
        .build();
    let mut results = Vec::new();

    for entry in walker {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        let entry = entry.map_err(|err| {
            AppError::String(format!(
                "failed walking workspace {}: {err}",
                base_dir.display()
            ))
        })?;
        if !entry.file_type().is_some_and(|ty| ty.is_file()) {
            continue;
        }

        let relative = match entry.path().strip_prefix(base_dir) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let path = format!("/{}", relative.to_string_lossy().replace('\\', "/"));
        let name = relative
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let score = fuzzy_score(
            &path.to_lowercase(),
            &name.to_lowercase(),
            &normalized_query,
        );
        if let Some(score) = score {
            results.push((
                score,
                FileNameSearchResult {
                    workspace_id: workspace_id.to_owned(),
                    path,
                    name,
                },
            ));
        }
    }

    Ok(results)
}

/// Search files
///
/// # Responses
///
/// 200: Json<FsSearchResponse> - Successfully searched files
/// 400: () - Failed to search files
///
/// # Metadata
///
/// @tag fs
#[rovo]
pub async fn search_files(
    State(state): State<AppState>,
    Query(query): Query<FsSearchHttpQuery>,
) -> impl IntoApiResponse {
    search_files_impl(state, query).await.into_response()
}

async fn search_files_impl(
    state: AppState,
    query: FsSearchHttpQuery,
) -> Result<impl IntoResponse, AppError> {
    let workspaces = workspace_roots(&state, query.workspace_id.as_deref())?;
    let query = query.search;
    let open_files = workspaces
        .iter()
        .map(|(id, _)| open_file_paths(&state, id, query.open_files_only))
        .collect::<Vec<_>>();

    let mut cancellation = SearchCancellation::new();
    let cancelled = cancellation.flag();
    let response = tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut truncated = false;
        for ((workspace_id, root), open) in workspaces.into_iter().zip(open_files) {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let remaining = query
                .max_results
                .map(|limit| limit.saturating_sub(results.len()));
            let response = search_files_blocking(
                &workspace_id,
                &root,
                &query,
                open.as_ref(),
                remaining,
                &cancelled,
            )?;
            results.extend(response.results);
            truncated |= response.truncated;
            if truncated {
                break;
            }
        }
        Ok::<_, AppError>(FsSearchResponse { results, truncated })
    })
    .await
    .map_err(|err| AppError::String(format!("search task failed: {err}")))??;
    cancellation.disarm();

    Ok(Json(response))
}

fn search_files_blocking(
    workspace_id: &str,
    base_dir: &Path,
    query: &FsSearchQuery,
    open_files: Option<&HashSet<PathBuf>>,
    max_results: Option<usize>,
    cancelled: &AtomicBool,
) -> Result<FsSearchResponse, AppError> {
    ensure_searchable_workspace(base_dir)?;
    if query.search.is_empty() {
        return Ok(FsSearchResponse {
            results: Vec::new(),
            truncated: false,
        });
    }
    let pattern = if query.regex {
        query.search.clone()
    } else {
        let escaped = regex::escape(&query.search);

        if query.match_whole_word {
            format!(r"\b{escaped}\b")
        } else {
            escaped
        }
    };

    let matcher = grep_regex::RegexMatcherBuilder::new()
        .case_insensitive(!query.regex && !query.match_case)
        .build(&pattern)
        .map_err(|err| AppError::String(format!("invalid search pattern: {err}")))?;

    let include = build_glob_set(query.include.as_deref())?;
    let exclude = build_glob_set(query.exclude.as_deref())?;

    let walker = ignore::WalkBuilder::new(base_dir)
        .hidden(false)
        .ignore(query.use_ignore_files)
        .git_ignore(query.use_ignore_files)
        .git_global(query.use_ignore_files)
        .git_exclude(query.use_ignore_files)
        .build();

    let mut results = Vec::new();
    let mut truncated = false;

    for entry in walker {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        let entry = entry.map_err(|err| {
            AppError::String(format!(
                "failed walking workspace {}: {err}",
                base_dir.display()
            ))
        })?;

        let path = entry.path();
        debug!(action = "searching", path = ?path.to_string_lossy());

        if !entry.file_type().is_some_and(|ty| ty.is_file()) {
            continue;
        }

        let relative_path = match path.strip_prefix(base_dir) {
            Ok(path) => path,
            Err(_) => {
                debug!(action = "searching", result = "cant strip prefix");
                continue;
            }
        };

        if open_files.is_some_and(|files| !files.contains(relative_path)) {
            debug!(action = "searching", result = "not an open file");
            continue;
        }

        if !matches_include(relative_path, &include) {
            debug!(action = "searching", result = "not in included path");
            continue;
        }

        if matches_exclude(relative_path, &exclude) {
            debug!(action = "searching", result = "in excluded path");
            continue;
        }

        let matches = match_file(path, &matcher, cancelled)?;

        if matches.is_empty() {
            debug!(action = "searching", result = "no matches found");
            continue;
        }

        debug!(action = "searching", result = "files found", paths = ?matches);

        if let Some(file) = FsFile::from_base_path(base_dir, relative_path)? {
            results.push(FsSearchResult {
                workspace_id: workspace_id.to_owned(),
                file,
                matches,
            });
            if let Some(limit) = max_results {
                if results.len() > limit {
                    results.truncate(limit);
                    truncated = true;
                    break;
                }
            }
        }
    }

    results.sort_by(|a, b| a.file.path.cmp(&b.file.path));

    Ok(FsSearchResponse { results, truncated })
}

/// Search files and replace occurrences of text found
///
/// # Responses
///
/// 200: Json<FsSearchResponse> - Files successfully edited and text replaced
/// 400: () - Failed to search files
///
/// # Metadata
///
/// @tag fs
#[rovo]
pub async fn search_and_replace_files(
    State(state): State<AppState>,
    Query(workspace): Query<SearchWorkspaceQuery>,
    Json(query): Json<FsSearchQuery>,
) -> impl IntoApiResponse {
    search_and_replace_files_impl(state, workspace.workspace_id, query)
        .await
        .into_response()
}

async fn search_and_replace_files_impl(
    state: AppState,
    workspace_id: Option<String>,
    query: FsSearchQuery,
) -> Result<impl IntoResponse, AppError> {
    let workspaces = workspace_roots(&state, workspace_id.as_deref())?;
    let open_files = workspaces
        .iter()
        .map(|(id, _)| open_file_paths(&state, id, query.open_files_only))
        .collect::<Vec<_>>();

    let pattern = if query.regex {
        query.search.clone()
    } else {
        let escaped = regex::escape(&query.search);

        if query.match_whole_word {
            format!(r"\b{escaped}\b")
        } else {
            escaped
        }
    };

    let response = tokio::task::spawn_blocking(move || -> Result<FsSearchResponse, AppError> {
        let mut response = FsSearchResponse {
            results: Vec::new(),
            truncated: false,
        };
        let never_cancelled = AtomicBool::new(false);
        for ((workspace_id, base_dir), open) in workspaces.into_iter().zip(open_files) {
            response.results.extend(
                search_files_blocking(
                    &workspace_id,
                    &base_dir,
                    &query,
                    open.as_ref(),
                    None,
                    &never_cancelled,
                )?
                .results,
            );
        }
        let is_regex = query.regex;
        let replace = query.replace;
        let case_insensitive = !query.regex && !query.match_case;
        let state = state.clone();
        for result in &response.results {
            replace_matches(
                &state.resolve_file_path(&result.workspace_id, &result.file.path)?,
                &pattern,
                case_insensitive,
                &replace,
                is_regex,
                query.preserve_case,
            )?;
        }
        return Ok(response);
    })
    .await
    .map_err(|err| AppError::String(format!("search task failed: {err}")))??;

    Ok(Json(response))
}

fn workspace_roots(
    state: &AppState,
    filter: Option<&str>,
) -> Result<Vec<(String, PathBuf)>, AppError> {
    match filter {
        Some(id) => Ok(vec![(id.to_owned(), state.workspace_root(&id.to_owned())?)]),
        None => state
            .config
            .workspaces
            .iter()
            .map(|workspace| Ok((workspace.id.clone(), state.workspace_root(&workspace.id)?)))
            .collect(),
    }
}

fn open_file_paths(
    state: &AppState,
    workspace_id: &str,
    only_open_files: bool,
) -> Option<HashSet<PathBuf>> {
    only_open_files.then(|| {
        state
            .open_files
            .iter()
            .filter(|entry| entry.key().0 == workspace_id)
            .map(|entry| relative_file_id(&entry.key().1))
            .collect()
    })
}

fn replace_matches(
    path: &Path,
    pattern: &str,
    case_insensitive: bool,
    replace: &str,
    is_regex: bool,
    preserve_case: bool,
) -> Result<(), AppError> {
    let content = std::fs::read_to_string(path)
        .map_err(|err| AppError::String(format!("failed to read {path:?}: {err}")))?;

    let re = regex::RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .build()
        .map_err(|err| AppError::String(format!("invalid pattern: {err}")))?;

    let mut new_content = String::with_capacity(content.len());
    let mut last_end = 0;

    for m in re.find_iter(&content) {
        new_content.push_str(&content[last_end..m.start()]);

        let replacement = if is_regex {
            // Expand capture refs ($1, $name) against this specific match first
            let mut expanded = String::new();
            let output = re.replace(m.as_str(), replace).to_string();
            output.clone_into(&mut expanded);
            expanded
        } else {
            replace.to_owned()
        };

        let final_replacement = if preserve_case {
            apply_case_pattern(m.as_str(), &replacement)
        } else {
            replacement
        };

        new_content.push_str(&final_replacement);
        last_end = m.end();
    }
    new_content.push_str(&content[last_end..]);

    if new_content != content {
        std::fs::write(path, &new_content)
            .map_err(|err| AppError::String(format!("failed to write {path:?}: {err}")))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        path::{Path, PathBuf},
        sync::atomic::AtomicBool,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::search_file_names_blocking;
    use crate::{
        models::FileNameSearchQuery,
        utils::file_search::{fuzzy_score, relative_file_id, truncate_results},
    };

    struct TestWorkspace(PathBuf);

    impl TestWorkspace {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "forge-file-search-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write(&self, relative: &str, contents: &str) {
            let path = self.0.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    fn file_name_query(search: &str) -> FileNameSearchQuery {
        FileNameSearchQuery {
            search: search.into(),
            workspace_id: None,
            max_results: None,
            use_ignore_files: true,
        }
    }

    #[test]
    fn fuzzy_score_handles_a_match_at_the_start_of_a_file_name() {
        assert!(fuzzy_score("/sweep.rs", "sweep.rs", "swee").is_some());
    }

    #[test]
    fn fuzzy_score_prefers_contiguous_file_name_matches() {
        let contiguous = fuzzy_score("/sweep.rs", "sweep.rs", "swee").unwrap();
        let scattered = fuzzy_score("/src/service.rs", "service.rs", "swee");
        assert!(scattered.is_none() || contiguous < scattered.unwrap());
    }

    #[test]
    fn fuzzy_score_prefers_shallower_paths_for_equal_file_names() {
        let shallow = fuzzy_score("/main.rs", "main.rs", "main").unwrap();
        let nested = fuzzy_score("/deep/nested/main.rs", "main.rs", "main").unwrap();
        assert!(shallow < nested);
    }

    #[test]
    fn result_limit_only_reports_actual_truncation() {
        let mut exact = vec![1, 2];
        assert!(!truncate_results(&mut exact, Some(2)));
        let mut too_many = vec![1, 2, 3];
        assert!(truncate_results(&mut too_many, Some(2)));
        assert_eq!(too_many, vec![1, 2]);
    }

    #[test]
    fn open_file_ids_match_walked_relative_paths() {
        let open_file = relative_file_id("/src/main.rs");
        assert_eq!(open_file, Path::new("src/main.rs"));
        assert_ne!(open_file, Path::new("src/lib.rs"));
    }

    #[test]
    fn file_name_search_handles_nested_and_unicode_paths() {
        let workspace = TestWorkspace::new();
        workspace.write("deep/nested/résumé.rs", "");
        workspace.write("resume.txt", "");
        let results = search_file_names_blocking(
            "test",
            &workspace.0,
            &file_name_query("rés"),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1.path, "/deep/nested/résumé.rs");
    }

    #[test]
    fn file_name_search_empty_query_returns_no_files() {
        let workspace = TestWorkspace::new();
        workspace.write("visible.rs", "");
        let results = search_file_names_blocking(
            "test",
            &workspace.0,
            &file_name_query("  "),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn file_name_search_respects_workspace_ignore_rules() {
        let workspace = TestWorkspace::new();
        workspace.write(".ignore", "ignored/\n");
        workspace.write("ignored/secret.rs", "");
        workspace.write("visible/secret.rs", "");

        let respected = search_file_names_blocking(
            "test",
            &workspace.0,
            &file_name_query("secret"),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(respected.len(), 1);
        assert_eq!(respected[0].1.path, "/visible/secret.rs");

        let mut query = file_name_query("secret");
        query.use_ignore_files = false;
        let disabled =
            search_file_names_blocking("test", &workspace.0, &query, &AtomicBool::new(false))
                .unwrap();
        assert_eq!(disabled.len(), 2);
    }

    #[test]
    fn file_name_search_stops_when_cancelled() {
        let workspace = TestWorkspace::new();
        workspace.write("match.rs", "");
        let results = search_file_names_blocking(
            "test",
            &workspace.0,
            &file_name_query("match"),
            &AtomicBool::new(true),
        )
        .unwrap();
        assert!(results.is_empty());
    }
}
