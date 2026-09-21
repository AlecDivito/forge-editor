use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Stable categories for every durable agent failure.
///
/// These values are part of the session-log schema. Diagnostic text belongs in
/// [`AgentError::detail`] and is never used as a category.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentFailureCode {
    InvalidProvider,
    MissingModelBackend,
    InvalidPrompt,
    TranscriptLimit,
    ModelClientInitializationFailed,
    ModelCatalogRequestFailed,
    ModelCatalogRejected,
    ModelCatalogInvalidResponse,
    InvalidModelBackendUrl,
    ModelStreamFailed,
    AgentExecutionFailed,
    ToolRoundLimitExceeded,
    ToolExecutionFailed,
    StorageWriteFailed,
    TitleGenerationFailed,
    TitlePersistFailed,
    SessionUnavailable,
    Unknown,
}

impl Default for AgentFailureCode {
    fn default() -> Self {
        Self::Unknown
    }
}

impl AgentFailureCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidProvider => "invalid_provider",
            Self::MissingModelBackend => "missing_model_backend",
            Self::InvalidPrompt => "invalid_prompt",
            Self::TranscriptLimit => "transcript_limit",
            Self::ModelClientInitializationFailed => "model_client_initialization_failed",
            Self::ModelCatalogRequestFailed => "model_catalog_request_failed",
            Self::ModelCatalogRejected => "model_catalog_rejected",
            Self::ModelCatalogInvalidResponse => "model_catalog_invalid_response",
            Self::InvalidModelBackendUrl => "invalid_model_backend_url",
            Self::ModelStreamFailed => "model_stream_failed",
            Self::AgentExecutionFailed => "agent_execution_failed",
            Self::ToolRoundLimitExceeded => "tool_round_limit_exceeded",
            Self::ToolExecutionFailed => "tool_execution_failed",
            Self::StorageWriteFailed => "storage_write_failed",
            Self::TitleGenerationFailed => "title_generation_failed",
            Self::TitlePersistFailed => "title_persist_failed",
            Self::SessionUnavailable => "session_unavailable",
            Self::Unknown => "unknown",
        }
    }
}

/// A safe-to-classify agent failure with diagnostic-only context.
#[derive(Clone, Debug)]
pub enum AgentError {
    InvalidRequest {
        code: AgentFailureCode,
        detail: String,
    },
    Unavailable {
        code: AgentFailureCode,
        detail: String,
    },
    Provider {
        code: AgentFailureCode,
        detail: String,
    },
    Storage {
        code: AgentFailureCode,
        detail: String,
    },
    Internal {
        code: AgentFailureCode,
        detail: String,
    },
}

impl AgentError {
    pub const fn code(&self) -> AgentFailureCode {
        match self {
            Self::InvalidRequest { code, .. }
            | Self::Unavailable { code, .. }
            | Self::Provider { code, .. }
            | Self::Storage { code, .. }
            | Self::Internal { code, .. } => *code,
        }
    }

    pub fn detail(&self) -> &str {
        match self {
            Self::InvalidRequest { detail, .. }
            | Self::Unavailable { detail, .. }
            | Self::Provider { detail, .. }
            | Self::Storage { detail, .. }
            | Self::Internal { detail, .. } => detail,
        }
    }

    pub const fn user_message(&self) -> &'static str {
        "Something went wrong. Please try again."
    }

    /// Logs diagnostic context and maps the error to a response that is safe
    /// to return over the HTTP API.
    pub fn into_app_error(self) -> AppError {
        tracing::error!(
            code = self.code().as_str(),
            detail = self.detail(),
            "agent request failed"
        );
        match self {
            Self::InvalidRequest { .. } => AppError::String(self.user_message().to_owned()),
            Self::Unavailable { .. } => AppError::Unavailable(self.user_message().to_owned()),
            Self::Provider { .. } => AppError::Upstream(self.user_message().to_owned()),
            Self::Storage { .. } | Self::Internal { .. } => {
                AppError::Internal(self.user_message().to_owned())
            }
        }
    }
}

impl From<AgentError> for AppError {
    fn from(error: AgentError) -> Self {
        error.into_app_error()
    }
}

#[cfg(test)]
mod tests {
    use super::AgentFailureCode;

    #[test]
    fn failure_codes_have_stable_json_names() {
        assert_eq!(
            serde_json::to_string(&AgentFailureCode::ModelStreamFailed).unwrap(),
            "\"model_stream_failed\""
        );
    }
}
