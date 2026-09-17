use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LspDiagnostic {
    pub range: LspRange,
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub source: Option<String>,       // e.g. "rust-analyzer", "eslint"
    pub code: Option<DiagnosticCode>, // e.g. "E0308", or eslint rule name
    pub tags: Vec<DiagnosticTag>,     // e.g. Unnecessary, Deprecated
    pub related_information: Vec<RelatedInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LspRange {
    pub start: LspPosition,
    pub end: LspPosition,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct LspPosition {
    pub line: u32,      // zero-indexed, per LSP spec
    pub character: u32, // UTF-16 code unit offset — see note below
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum DiagnosticCode {
    Number(i64),
    String(String),
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[repr(u8)]
pub enum DiagnosticTag {
    Unnecessary = 1,
    Deprecated = 2,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RelatedInfo {
    pub location_uri: String, // could be a different file than the diagnostic itself
    pub range: LspRange,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawRelatedInfo {
    pub location: RawLocation,
    pub message: String,
}

#[derive(Deserialize)]
pub struct RawLocation {
    pub uri: String,
    pub range: LspRange,
}

impl From<RawRelatedInfo> for RelatedInfo {
    fn from(raw: RawRelatedInfo) -> Self {
        RelatedInfo {
            location_uri: raw.location.uri,
            range: raw.location.range,
            message: raw.message,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawLspDiagnostic {
    range: LspRange,
    severity: Option<u8>,
    code: Option<serde_json::Value>,
    source: Option<String>,
    message: String,
    tags: Option<Vec<u8>>,
    related_information: Option<Vec<RawRelatedInfo>>,
}

impl From<RawLspDiagnostic> for LspDiagnostic {
    fn from(raw: RawLspDiagnostic) -> Self {
        LspDiagnostic {
            range: raw.range,
            severity: match raw.severity {
                Some(1) => DiagnosticSeverity::Error,
                Some(2) => DiagnosticSeverity::Warning,
                Some(3) => DiagnosticSeverity::Information,
                Some(4) => DiagnosticSeverity::Hint,
                _ => DiagnosticSeverity::Warning, // spec-absent default
            },
            message: raw.message,
            source: raw.source,
            code: raw.code.and_then(|v| match v {
                serde_json::Value::Number(n) => n.as_i64().map(DiagnosticCode::Number),
                serde_json::Value::String(s) => Some(DiagnosticCode::String(s)),
                _ => None,
            }),
            tags: raw
                .tags
                .unwrap_or_default()
                .into_iter()
                .filter_map(|t| match t {
                    1 => Some(DiagnosticTag::Unnecessary),
                    2 => Some(DiagnosticTag::Deprecated),
                    _ => None,
                })
                .collect(),
            related_information: raw
                .related_information
                .unwrap_or_default()
                .into_iter()
                .map(Into::into)
                .collect(),
        }
    }
}
