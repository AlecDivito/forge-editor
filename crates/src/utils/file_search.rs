use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::RegexMatcher;

use crate::{error::AppError, models::FsSearchLine};

pub fn fuzzy_score(path: &str, name: &str, query: &str) -> Option<usize> {
    fn score(candidate: &str, query: &str) -> Option<usize> {
        let mut cursor = 0;
        let mut previous_end = None;
        let mut total = 0;
        for character in query.chars() {
            let index = candidate[cursor..].find(character)? + cursor;
            total += index + if previous_end == Some(index) { 0 } else { 2 };
            cursor = index + character.len_utf8();
            previous_end = Some(cursor);
        }
        Some(total)
    }
    let path_score = score(path, query)?;
    let depth_penalty = path.bytes().filter(|byte| *byte == b'/').count() * 3;
    let name_score = score(name, query).map(|value| value.saturating_sub(30));
    let exact_name_bonus = (name == query).then_some(50).unwrap_or(0);
    Some(
        name_score
            .unwrap_or(path_score)
            .min(path_score)
            .saturating_add(depth_penalty)
            .saturating_sub(exact_name_bonus),
    )
}

pub fn truncate_results<T>(results: &mut Vec<T>, limit: Option<usize>) -> bool {
    let Some(limit) = limit else {
        return false;
    };
    let truncated = results.len() > limit;
    results.truncate(limit);
    truncated
}

pub fn ensure_searchable_workspace(base_dir: &Path) -> Result<(), AppError> {
    let metadata = std::fs::metadata(base_dir).map_err(|err| {
        AppError::String(format!(
            "workspace path cannot be opened ({}): {err}",
            base_dir.display()
        ))
    })?;
    if !metadata.is_dir() {
        return Err(AppError::String(format!(
            "workspace path is not a directory: {}",
            base_dir.display()
        )));
    }
    std::fs::read_dir(base_dir).map_err(|err| {
        AppError::String(format!(
            "workspace directory cannot be opened ({}): {err}",
            base_dir.display()
        ))
    })?;
    Ok(())
}

pub fn relative_file_id(file_id: &str) -> PathBuf {
    let path = Path::new(file_id);
    path.strip_prefix("/").unwrap_or(path).to_path_buf()
}

pub fn apply_case_pattern(matched: &str, replacement: &str) -> String {
    if matched
        .chars()
        .all(|c| !c.is_alphabetic() || c.is_uppercase())
    {
        replacement.to_uppercase()
    } else if matched
        .chars()
        .all(|c| !c.is_alphabetic() || c.is_lowercase())
    {
        replacement.to_lowercase()
    } else if matched.chars().next().is_some_and(|c| c.is_uppercase())
        && matched
            .chars()
            .skip(1)
            .all(|c| !c.is_alphabetic() || c.is_lowercase())
    {
        let mut chars = replacement.chars();
        match chars.next() {
            Some(first) => {
                first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
            }
            None => String::new(),
        }
    } else {
        replacement.to_owned()
    }
}

pub fn build_glob_set(patterns: Option<&str>) -> Result<Option<GlobSet>, AppError> {
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
        builder.add(
            Glob::new(pattern)
                .map_err(|err| AppError::String(format!("invalid glob `{pattern}`: {err}")))?,
        );
    }
    Ok(Some(builder.build().map_err(|err| {
        AppError::String(format!("invalid glob set: {err}"))
    })?))
}

pub fn matches_include(path: &Path, include: &Option<GlobSet>) -> bool {
    let Some(include) = include else {
        return true;
    };
    include.is_match(path)
        || path
            .file_name()
            .is_some_and(|name| include.is_match(Path::new(name)))
}

pub fn matches_exclude(path: &Path, exclude: &Option<GlobSet>) -> bool {
    let Some(exclude) = exclude else {
        return false;
    };
    exclude.is_match(path)
        || path
            .file_name()
            .is_some_and(|name| exclude.is_match(Path::new(name)))
}

pub fn match_file(
    path: &Path,
    matcher: &RegexMatcher,
    cancelled: &AtomicBool,
) -> Result<Vec<FsSearchLine>, AppError> {
    let mut matches = Vec::new();
    let mut searcher = grep_searcher::SearcherBuilder::new()
        .line_number(true)
        .build();
    searcher
        .search_path(
            matcher,
            path,
            grep_searcher::sinks::UTF8(|line_number, line| {
                if cancelled.load(Ordering::Relaxed) {
                    return Ok(false);
                }
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
        .map_err(|err| {
            AppError::String(format!(
                "failed to open or search file {}: {err}",
                path.display()
            ))
        })?;
    Ok(matches)
}
