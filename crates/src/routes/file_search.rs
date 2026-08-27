use std::{path::Path, sync::Arc};

use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::RegexMatcher;
use rovo::{axum::IntoApiResponse, rovo};
use tracing::debug;

use crate::{
    error::AppError,
    models::{FsFile, FsSearchLine, FsSearchQuery, FsSearchResult},
    state::AppState,
};

use crate::models::FsSearchResponse;

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
    State(state): State<Arc<AppState>>,
    Query(query): Query<FsSearchQuery>,
) -> impl IntoApiResponse {
    search_files_impl(state, query).await.into_response()
}

async fn search_files_impl(
    state: Arc<AppState>,
    query: FsSearchQuery,
) -> Result<impl IntoResponse, AppError> {
    let base_dir = state.config.base_dir.clone();

    let response = tokio::task::spawn_blocking(move || search_files_blocking(&base_dir, query))
        .await
        .map_err(|err| AppError::String(format!("search task failed: {err}")))??;

    Ok(Json(response))
}

fn search_files_blocking(
    base_dir: &Path,
    query: FsSearchQuery,
) -> Result<FsSearchResponse, AppError> {
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
        .git_ignore(query.use_ignore_files)
        .git_global(query.use_ignore_files)
        .git_exclude(query.use_ignore_files)
        .build();

    let mut results = Vec::new();

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

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

        if !matches_include(relative_path, &include) {
            debug!(action = "searching", result = "not in included path");
            continue;
        }

        if matches_exclude(relative_path, &exclude) {
            debug!(action = "searching", result = "in excluded path");
            continue;
        }

        let matches = match_file(path, &matcher)?;

        if matches.is_empty() {
            debug!(action = "searching", result = "no matches found");
            continue;
        }

        debug!(action = "searching", result = "files found", paths = ?matches);

        if let Some(file) = FsFile::from_base_path(base_dir, relative_path)? {
            results.push(FsSearchResult { file, matches });
        }
    }

    results.sort_by(|a, b| a.file.path.cmp(&b.file.path));

    Ok(FsSearchResponse { results })
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
    State(state): State<Arc<AppState>>,
    Json(query): Json<FsSearchQuery>,
) -> impl IntoApiResponse {
    search_and_replace_files_impl(state, query)
        .await
        .into_response()
}

async fn search_and_replace_files_impl(
    state: Arc<AppState>,
    query: FsSearchQuery,
) -> Result<impl IntoResponse, AppError> {
    let base_dir = state.config.base_dir.clone();

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
        let response = search_files_blocking(&base_dir, query.clone())?;
        let is_regex = query.regex;
        let replace = query.replace;
        let case_insensitive = !query.regex && !query.match_case;
        let state = state.clone();
        for result in &response.results {
            replace_matches(
                &state.to_absolute_path(&result.file.path)?,
                &pattern,
                case_insensitive,
                &replace,
                is_regex,
                query.preserve_case,
            )?;
        }
        return Ok(response)
    })
    .await
    .map_err(|err| AppError::String(format!("search task failed: {err}")))??;

    Ok(Json(response))
}

fn apply_case_pattern(matched: &str, replacement: &str) -> String {
    if matched.chars().all(|c| !c.is_alphabetic() || c.is_uppercase()) {
        replacement.to_uppercase()
    } else if matched.chars().all(|c| !c.is_alphabetic() || c.is_lowercase()) {
        replacement.to_lowercase()
    } else if matched.chars().next().is_some_and(|c| c.is_uppercase())
        && matched.chars().skip(1).all(|c| !c.is_alphabetic() || c.is_lowercase())
    {
        // Title case: capitalize first char, lowercase the rest
        let mut chars = replacement.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
            None => String::new(),
        }
    } else {
        // Mixed case, e.g. "camelCase" or "SCREAMING_SNAKE" partials — leave as-is
        replacement.to_owned()
    }
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

fn build_glob_set(patterns: Option<&str>) -> Result<Option<GlobSet>, AppError> {
    let Some(patterns) = patterns else {
        return Ok(None);
    };

    if patterns.is_empty() {
        return Ok(None);
    }

    let mut builder = GlobSetBuilder::new();

    for pattern in patterns
        .split(',')
        .map(str::trim)
        .filter(|pattern| !pattern.is_empty())
    {
        let glob = Glob::new(pattern)
            .map_err(|err| AppError::String(format!("invalid glob `{pattern}`: {err}")))?;

        builder.add(glob);
    }

    let set = builder
        .build()
        .map_err(|err| AppError::String(format!("invalid glob set: {err}")))?;

    Ok(Some(set))
}

fn matches_include(path: &Path, include: &Option<GlobSet>) -> bool {
    let Some(include) = include else {
        return true;
    };

    include.is_match(path)
        || path
            .file_name()
            .is_some_and(|name| include.is_match(Path::new(name)))
}

fn matches_exclude(path: &Path, exclude: &Option<GlobSet>) -> bool {
    let Some(exclude) = exclude else {
        return false;
    };

    exclude.is_match(path)
        || path
            .file_name()
            .is_some_and(|name| exclude.is_match(Path::new(name)))
}

fn match_file(path: &Path, matcher: &RegexMatcher) -> Result<Vec<FsSearchLine>, AppError> {
    let mut matches = Vec::new();

    let mut searcher = grep_searcher::SearcherBuilder::new()
        .line_number(true)
        .build();

    searcher
        .search_path(
            matcher,
            path,
            grep_searcher::sinks::UTF8(|line_number, line| {
                let matching = matcher.find(line.as_bytes())?.unwrap();
                matches.push(FsSearchLine {
                    line: line_number as usize,
                    text: line.trim_end_matches('\n').to_owned(),
                    start: matching.start(),
                    end: matching.end(),
                });

                Ok(true)
            }),
        )
        .map_err(|err| AppError::String(format!("failed searching file: {err}")))?;

    Ok(matches)
}
