use crate::models::LspPosition;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

fn hash_line(line: &str) -> u64 {
    let mut h = DefaultHasher::new();
    line.hash(&mut h);
    h.finish()
}

/// Splits on '\n', keeping the terminator attached to each line so byte
/// offsets stay exact on reconstruction — `str::lines()` strips it and
/// would throw off every offset downstream.
fn split_lines_keep_ends(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    for (i, b) in text.bytes().enumerate() {
        if b == b'\n' {
            lines.push(&text[start..=i]);
            start = i + 1;
        }
    }
    if start < text.len() {
        lines.push(&text[start..]);
    }
    lines
}

pub struct ChangeRange {
    pub old_start: usize,
    pub old_end: usize,
    pub new_text: String,
}

/// Two-pass diff: narrow to the differing *lines* via hash comparison
/// (cheap — O(line count) integer compares, one hash pass over the file),
/// then run a tight char-level prefix/suffix trim only within that
/// narrowed span. The expensive per-char work is bounded by how much
/// actually changed, not by file size — a single-line edit deep in a
/// 5,000-line file costs roughly "hash 5,000 lines + diff 1 line."
pub fn diff(old: &str, new: &str) -> Option<ChangeRange> {
    if old == new {
        return None;
    }

    let old_lines = split_lines_keep_ends(old);
    let new_lines = split_lines_keep_ends(new);
    let old_hashes: Vec<u64> = old_lines.iter().map(|l| hash_line(l)).collect();
    let new_hashes: Vec<u64> = new_lines.iter().map(|l| hash_line(l)).collect();

    let mut prefix_lines = 0;
    while prefix_lines < old_lines.len()
        && prefix_lines < new_lines.len()
        && old_hashes[prefix_lines] == new_hashes[prefix_lines]
        && old_lines[prefix_lines] == new_lines[prefix_lines]
    // guards a hash collision
    {
        prefix_lines += 1;
    }

    let max_suffix = (old_lines.len() - prefix_lines).min(new_lines.len() - prefix_lines);
    let mut suffix_lines = 0;
    while suffix_lines < max_suffix
        && old_hashes[old_lines.len() - 1 - suffix_lines]
            == new_hashes[new_lines.len() - 1 - suffix_lines]
        && old_lines[old_lines.len() - 1 - suffix_lines]
            == new_lines[new_lines.len() - 1 - suffix_lines]
    {
        suffix_lines += 1;
    }

    let old_span_start: usize = old_lines[..prefix_lines].iter().map(|l| l.len()).sum();
    let old_span_end = old.len()
        - old_lines[old_lines.len() - suffix_lines..]
            .iter()
            .map(|l| l.len())
            .sum::<usize>();
    let new_span_start: usize = new_lines[..prefix_lines].iter().map(|l| l.len()).sum();
    let new_span_end = new.len()
        - new_lines[new_lines.len() - suffix_lines..]
            .iter()
            .map(|l| l.len())
            .sum::<usize>();

    let (char_prefix, char_suffix) = char_prefix_suffix(
        &old[old_span_start..old_span_end],
        &new[new_span_start..new_span_end],
    );

    Some(ChangeRange {
        old_start: old_span_start + char_prefix,
        old_end: old_span_end - char_suffix,
        new_text: new[new_span_start + char_prefix..new_span_end - char_suffix].to_string(),
    })
}

/// Common prefix/suffix byte-length between two strings, char-boundary
/// safe. Only called on the already-narrowed span from `diff`, so cost
/// is bounded by that span, not the file. Prefix/suffix byte lengths are
/// identical in both strings since equal chars have equal UTF-8 length.
fn char_prefix_suffix(a: &str, b: &str) -> (usize, usize) {
    let a_chars: Vec<(usize, char)> = a.char_indices().collect();
    let b_chars: Vec<(usize, char)> = b.char_indices().collect();

    let mut prefix = 0;
    while prefix < a_chars.len() && prefix < b_chars.len() && a_chars[prefix].1 == b_chars[prefix].1
    {
        prefix += 1;
    }
    let prefix_len = a_chars
        .get(prefix)
        .map(|(i, _)| *i)
        .unwrap_or(a.len().min(b.len()));

    let max_suffix = (a_chars.len() - prefix).min(b_chars.len() - prefix);
    let mut suffix = 0;
    while suffix < max_suffix
        && a_chars[a_chars.len() - 1 - suffix].1 == b_chars[b_chars.len() - 1 - suffix].1
    {
        suffix += 1;
    }
    let suffix_len = if suffix == 0 {
        0
    } else {
        a.len() - a_chars[a_chars.len() - suffix].0
    };

    (prefix_len, suffix_len)
}

pub fn byte_offset_to_position(text: &str, byte_offset: usize, encoding: &str) -> LspPosition {
    let mut line = 0u32;
    let mut character = 0u32;
    for ch in text[..byte_offset].chars() {
        if ch == '\n' {
            line += 1;
            character = 0;
        } else {
            character += if encoding == "utf-8" {
                ch.len_utf8() as u32
            } else {
                ch.len_utf16() as u32
            };
        }
    }
    LspPosition { line, character }
}
