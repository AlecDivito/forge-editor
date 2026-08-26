use std::{path::Path, sync::Arc};

use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_regex::RegexMatcher;
use rovo::{axum::IntoApiResponse, rovo};
use tracing::debug;
use grep_matcher::Matcher;

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
                continue
            },
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

fn build_glob_set(patterns: Option<&str>) -> Result<Option<GlobSet>, AppError> {
    let Some(patterns) = patterns else {
        return Ok(None);
    };

    if patterns.is_empty() {
        return Ok(None)
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
