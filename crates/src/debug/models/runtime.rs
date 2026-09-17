use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

pub type BreakpointRevision = u64;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestedSourceBreakpoint {
    pub breakpoint_id: String,
    pub workspace_id: String,
    pub file_id: String,
    /// Zero-based UTF-16 editor line.
    pub line: u32,
    pub column: Option<u32>,
    pub enabled: bool,
    pub condition: Option<String>,
    pub hit_condition: Option<String>,
    pub log_message: Option<String>,
    pub revision: BreakpointRevision,
}

/// Adapter reconciliation for one durable breakpoint intent. This state is
/// deliberately session-scoped and is discarded with the debug session.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedBreakpoint {
    pub requested_breakpoint_id: String,
    pub adapter_breakpoint_id: Option<i64>,
    pub verified: bool,
    pub resolved_source: Option<PublicSource>,
    pub resolved_line: Option<u32>,
    pub resolved_column: Option<u32>,
    pub message: Option<String>,
    pub session_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBreakpoint {
    pub file_id: String,
    pub line: u32,
    pub column: Option<u32>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    pub condition: Option<String>,
    pub hit_condition: Option<String>,
    pub log_message: Option<String>,
}
fn enabled_by_default() -> bool {
    true
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateBreakpoint {
    pub expected_revision: BreakpointRevision,
    pub line: Option<u32>,
    pub column: Option<Option<u32>>,
    pub enabled: Option<bool>,
    pub condition: Option<Option<String>>,
    pub hit_condition: Option<Option<String>>,
    pub log_message: Option<Option<String>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteBreakpoint {
    pub expected_revision: BreakpointRevision,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointList {
    pub schema_version: u32,
    pub revision: BreakpointRevision,
    pub breakpoints: Vec<RequestedSourceBreakpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub supports_configuration_done: bool,
    pub supports_conditional_breakpoints: bool,
    pub supports_hit_conditional_breakpoints: bool,
    pub supports_log_points: bool,
    pub supports_pause: bool,
    pub supports_step_back: bool,
    pub supports_variable_paging: bool,
    pub supports_variable_type: bool,
    pub supports_value_formatting: bool,
    pub supports_loaded_sources: bool,
    pub limits: DebugLimits,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugLimits {
    pub threads: usize,
    pub stack_page: u32,
    pub variable_page: u32,
    pub variable_nodes: usize,
    pub variable_depth: u8,
    pub display_bytes: usize,
    pub watches: usize,
    pub expression_bytes: usize,
    pub generated_source_bytes: usize,
    pub concurrent_inspection_requests: usize,
    pub console_records: usize,
    pub console_bytes: usize,
}

impl Default for DebugLimits {
    fn default() -> Self {
        Self {
            threads: crate::debug::limits::MAX_THREADS,
            stack_page: crate::debug::limits::MAX_STACK_LEVELS,
            variable_page: crate::debug::limits::MAX_VARIABLES_PER_PAGE,
            variable_nodes: crate::debug::limits::MAX_VARIABLE_NODES,
            variable_depth: crate::debug::limits::MAX_VARIABLE_DEPTH,
            display_bytes: crate::debug::limits::MAX_DISPLAY_BYTES,
            watches: crate::debug::limits::MAX_WATCHES,
            expression_bytes: crate::debug::limits::MAX_EXPRESSION_BYTES,
            generated_source_bytes: crate::debug::limits::MAX_SOURCE_BYTES,
            concurrent_inspection_requests:
                crate::debug::limits::MAX_CONCURRENT_INSPECTION_REQUESTS,
            console_records: crate::debug::limits::MAX_CONSOLE_RECORDS,
            console_bytes: crate::debug::limits::MAX_CONSOLE_BYTES,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PublicSource {
    Workspace {
        workspace_id: String,
        file_id: String,
    },
    Generated {
        session_id: String,
        source_handle: String,
        name: Option<String>,
    },
    Unavailable {
        safe_name: Option<String>,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugThread {
    pub thread_handle: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugThreadsResult {
    pub session_id: String,
    pub stopped_generation: u64,
    pub threads: Vec<DebugThread>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugStackFrame {
    pub frame_handle: String,
    pub name: String,
    pub source: PublicSource,
    pub line: u32,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugStackResult {
    pub session_id: String,
    pub stopped_generation: u64,
    pub frames: Vec<DebugStackFrame>,
    pub total_frames: Option<u32>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DebugErrorCode {
    SessionNotFound,
    SessionForbidden,
    NotStopped,
    StaleGeneration,
    StaleHandle,
    ThreadNotFound,
    CapabilityUnsupported,
    SourceUnmapped,
    RequestTimeout,
    ResultTooLarge,
    AdapterFailed,
    Busy,
    RevisionConflict,
}

/// Generation-scoped authority map. Adapter numeric IDs never cross the wire.
#[derive(Debug, Default)]
pub struct OpaqueHandleTable {
    session_id: String,
    generation: u64,
    threads: HashMap<String, i64>,
    frames: HashMap<String, i64>,
    variables: HashMap<String, (i64, u8)>,
    sources: HashMap<String, (i64, Option<String>)>,
}

impl OpaqueHandleTable {
    pub fn reset(&mut self, session_id: &str, generation: u64) {
        self.session_id = session_id.into();
        self.generation = generation;
        self.threads.clear();
        self.frames.clear();
        self.variables.clear();
        self.sources.clear();
    }
    pub fn issue_variables(&mut self, adapter_id: i64, depth: u8) -> anyhow::Result<String> {
        if depth > crate::debug::limits::MAX_VARIABLE_DEPTH
            || self.variables.len() >= crate::debug::limits::MAX_VARIABLE_NODES
        {
            anyhow::bail!("debug_result_too_large")
        }
        let handle = Uuid::new_v4().to_string();
        self.variables.insert(handle.clone(), (adapter_id, depth));
        Ok(handle)
    }
    pub fn variables(
        &self,
        session: &str,
        generation: u64,
        handle: &str,
    ) -> anyhow::Result<(i64, u8)> {
        self.validate(session, generation)?;
        self.variables
            .get(handle)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("debug_stale_handle"))
    }
    pub fn issue_source(&mut self, source_reference: i64, name: Option<String>) -> String {
        let handle = Uuid::new_v4().to_string();
        self.sources
            .insert(handle.clone(), (source_reference, name));
        handle
    }
    pub fn source(&self, session: &str, generation: u64, handle: &str) -> anyhow::Result<i64> {
        self.validate(session, generation)?;
        self.sources
            .get(handle)
            .map(|source| source.0)
            .ok_or_else(|| anyhow::anyhow!("debug_stale_handle"))
    }
    pub fn source_name(
        &self,
        session: &str,
        generation: u64,
        handle: &str,
    ) -> anyhow::Result<Option<String>> {
        self.validate(session, generation)?;
        self.sources
            .get(handle)
            .map(|source| source.1.clone())
            .ok_or_else(|| anyhow::anyhow!("debug_stale_handle"))
    }
    pub fn issue_thread(&mut self, adapter_id: i64) -> String {
        let handle = Uuid::new_v4().to_string();
        self.threads.insert(handle.clone(), adapter_id);
        handle
    }
    pub fn issue_frame(&mut self, adapter_id: i64) -> anyhow::Result<String> {
        if self.frames.len() >= crate::debug::limits::MAX_FRAME_HANDLES {
            anyhow::bail!("debug_result_too_large")
        }
        let handle = Uuid::new_v4().to_string();
        self.frames.insert(handle.clone(), adapter_id);
        Ok(handle)
    }
    pub fn thread(&self, session: &str, generation: u64, handle: &str) -> anyhow::Result<i64> {
        self.validate(session, generation)?;
        self.threads
            .get(handle)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("debug_stale_handle"))
    }
    pub fn frame(&self, session: &str, generation: u64, handle: &str) -> anyhow::Result<i64> {
        self.validate(session, generation)?;
        self.frames
            .get(handle)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("debug_stale_handle"))
    }
    fn validate(&self, session: &str, generation: u64) -> anyhow::Result<()> {
        if self.session_id != session {
            anyhow::bail!("debug_session_forbidden")
        }
        if self.generation != generation {
            anyhow::bail!("debug_stale_generation")
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugScope {
    pub name: String,
    pub variables_handle: String,
    pub expensive: bool,
    pub named_variables: Option<u32>,
    pub indexed_variables: Option<u32>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugScopesResult {
    pub session_id: String,
    pub stopped_generation: u64,
    pub scopes: Vec<DebugScope>,
    pub truncated: bool,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariable {
    pub name: String,
    pub value: String,
    pub r#type: Option<String>,
    pub variables_handle: Option<String>,
    pub named_variables: Option<u32>,
    pub indexed_variables: Option<u32>,
    pub value_truncated: bool,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariablesResult {
    pub session_id: String,
    pub stopped_generation: u64,
    pub variables: Vec<DebugVariable>,
    pub truncated: bool,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugEvaluationResult {
    pub session_id: String,
    pub stopped_generation: u64,
    pub value: String,
    pub r#type: Option<String>,
    pub variables_handle: Option<String>,
    pub value_truncated: bool,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugSourceResult {
    pub session_id: String,
    pub stopped_generation: u64,
    pub name: Option<String>,
    pub content: String,
    pub mime_type: Option<String>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DebugWatch {
    pub watch_id: String,
    pub expression: String,
    pub auto_refresh: bool,
    pub last_result: Option<DebugEvaluationResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum DebugOperation {
    Threads,
    StackTrace {
        thread_handle: String,
        start_frame: Option<u32>,
        levels: Option<u32>,
    },
    Scopes {
        frame_handle: String,
    },
    Variables {
        variables_handle: String,
        filter: Option<String>,
        start: Option<u32>,
        count: Option<u32>,
    },
    Evaluate {
        expression: String,
        frame_handle: Option<String>,
        context: EvaluationContext,
    },
    Source {
        source_handle: String,
    },
    Continue {
        thread_handle: String,
    },
    Pause {
        thread_handle: Option<String>,
    },
    Next {
        thread_handle: String,
    },
    StepIn {
        thread_handle: String,
    },
    StepOut {
        thread_handle: String,
    },
    WatchCreate {
        expression: String,
        auto_refresh: bool,
    },
    WatchUpdate {
        watch_id: String,
        expression: Option<String>,
        auto_refresh: Option<bool>,
    },
    WatchDelete {
        watch_id: String,
    },
    WatchRefresh {
        watch_id: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationContext {
    Repl,
    Watch,
}

pub fn bounded_display(mut value: String) -> (String, bool) {
    let max = crate::debug::limits::MAX_DISPLAY_BYTES;
    if value.len() <= max {
        return (value, false);
    }
    let mut boundary = max;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1
    }
    value.truncate(boundary);
    value.push('…');
    (value, true)
}

/// Convert Forge's zero-based positions to negotiated DAP conventions.
pub fn public_to_dap(value: u32, starts_at_one: bool) -> u64 {
    u64::from(value) + u64::from(starts_at_one)
}
/// Convert untrusted DAP positions without underflow.
pub fn dap_to_public(value: u64, starts_at_one: bool) -> Option<u32> {
    let value = value.checked_sub(u64::from(starts_at_one))?;
    u32::try_from(value).ok()
}

#[cfg(test)]
mod runtime_tests {
    use super::*;
    #[test]
    fn positions_are_checked() {
        assert_eq!(public_to_dap(0, true), 1);
        assert_eq!(dap_to_public(1, true), Some(0));
        assert_eq!(dap_to_public(0, true), None);
        assert_eq!(dap_to_public(u64::MAX, false), None);
    }
    #[test]
    fn handles_are_generation_and_session_scoped() {
        let mut table = OpaqueHandleTable::default();
        table.reset("one", 1);
        let old = table.issue_thread(7);
        assert_eq!(table.thread("one", 1, &old).unwrap(), 7);
        table.reset("one", 2);
        let new = table.issue_thread(7);
        assert!(table.thread("one", 1, &old).is_err());
        assert!(table.thread("one", 2, &old).is_err());
        assert_eq!(table.thread("one", 2, &new).unwrap(), 7);
        assert!(table.thread("two", 2, &new).is_err());
    }
    #[test]
    fn phase_three_handles_invalidate_and_display_truncates_on_utf8_boundaries() {
        let mut table = OpaqueHandleTable::default();
        table.reset("s", 3);
        let variables = table.issue_variables(99, 1).unwrap();
        let source = table.issue_source(44, Some("generated.rs".into()));
        assert_eq!(table.variables("s", 3, &variables).unwrap(), (99, 1));
        assert_eq!(table.source("s", 3, &source).unwrap(), 44);
        table.reset("s", 4);
        assert!(table.variables("s", 3, &variables).is_err());
        assert!(table.source("s", 4, &source).is_err());
        let (value, truncated) =
            bounded_display("é".repeat(crate::debug::limits::MAX_DISPLAY_BYTES));
        assert!(truncated);
        assert!(value.is_char_boundary(value.len()));
        assert!(value.ends_with('…'));
    }
}
