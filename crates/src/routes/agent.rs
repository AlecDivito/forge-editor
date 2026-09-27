use std::time::Duration;

use axum::{
    Json,
    extract::{Path, Query, State},
    response::{IntoResponse, Redirect},
};
use rovo::{axum::IntoApiResponse, rovo, schemars::JsonSchema};
use serde::Deserialize;

use crate::{
    agent::error::{AgentError, AgentFailureCode},
    error::AppError,
    models::{
        AgentModelCatalog, AgentModelDescriptor, AgentSessionLog, AiSessionSummary,
        CompleteAgentAttachment, CompletedAgentAttachment, PrepareAgentAttachment,
        PreparedAgentAttachment,
    },
    state::AppState,
};

#[derive(Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModel>,
}

#[derive(Deserialize)]
struct OpenAiModel {
    id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AgentSessionSearchQuery {
    /// Case-insensitive text matched against session titles and message content.
    pub query: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AgentSessionPath {
    /// Opaque conversation ID used to address the durable session.
    pub session_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AgentAttachmentPath {
    /// Opaque conversation ID that owns the attachment.
    pub session_id: String,
    /// Opaque attachment ID created by the prepare endpoint.
    pub attachment_id: String,
}

/// List models from the configured OpenAI-compatible backend.
///
/// The backend is included only when both OPENAI_API_BASE_URL and
/// OPENAI_API_KEY are configured. Credentials never leave this process.
///
/// # Responses
///
/// 200: Json<AgentModelCatalog> - The available model catalog or an unconfigured catalog
/// 502: () - The configured backend could not be contacted or returned an invalid response
///
/// # Metadata
///
/// @tag agent
#[rovo]
pub async fn list_models(State(state): State<AppState>) -> impl IntoApiResponse {
    list_models_impl(state).await.into_response()
}

async fn list_models_impl(state: AppState) -> Result<impl IntoResponse, AppError> {
    let Some(config) = state.config.openai_compatible.as_ref() else {
        return Ok(Json(AgentModelCatalog {
            configured: false,
            models: Vec::new(),
        }));
    };
    let endpoint = models_endpoint(&config.base_url).map_err(AppError::from)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| AgentError::Internal {
            code: AgentFailureCode::ModelClientInitializationFailed,
            detail: error.to_string(),
        })?;
    let response = client
        .get(endpoint)
        .bearer_auth(config.api_key())
        .send()
        .await
        .map_err(|error| AgentError::Provider {
            code: AgentFailureCode::ModelCatalogRequestFailed,
            detail: error.to_string(),
        })?;
    if !response.status().is_success() {
        return Err(AgentError::Provider {
            code: AgentFailureCode::ModelCatalogRejected,
            detail: format!("model catalog request returned HTTP {}", response.status()),
        }
        .into());
    }
    let payload = response
        .json::<OpenAiModelsResponse>()
        .await
        .map_err(|error| AgentError::Provider {
            code: AgentFailureCode::ModelCatalogInvalidResponse,
            detail: error.to_string(),
        })?;
    let models = normalize_models(payload);
    Ok(Json(AgentModelCatalog {
        configured: true,
        models,
    }))
}

fn models_endpoint(base_url: &str) -> Result<reqwest::Url, AgentError> {
    let base_url = format!("{}/", base_url.trim_end_matches('/'));
    reqwest::Url::parse(&base_url)
        .and_then(|base_url| base_url.join("models"))
        .map_err(|error| AgentError::InvalidRequest {
            code: AgentFailureCode::InvalidModelBackendUrl,
            detail: error.to_string(),
        })
}

fn normalize_models(payload: OpenAiModelsResponse) -> Vec<AgentModelDescriptor> {
    let mut models = payload
        .data
        .into_iter()
        .filter(|model| !model.id.is_empty())
        .map(|model| AgentModelDescriptor {
            label: model.id.clone(),
            id: model.id,
            provider: "openai-compatible".into(),
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.label.cmp(&right.label));
    models
}

/// List durable AI sessions already loaded by the session service.
///
/// The optional `query` parameter searches both titles and completed message
/// content without rereading JSONL files.
///
/// # Responses
///
/// 200: Json<Vec<AiSessionSummary>> - The durable session summaries
///
/// # Metadata
///
/// @tag agent
#[rovo]
pub async fn list_sessions(
    State(state): State<AppState>,
    Query(query): Query<AgentSessionSearchQuery>,
) -> impl IntoApiResponse {
    Json(state.ai_sessions.list(query.query.as_deref()))
}

/// Get a complete durable AI conversation for frontend restoration.
///
/// # Path Parameters
/// session_id: String - Opaque conversation ID of the durable session
///
/// # Responses
///
/// 200: Json<AgentSessionLog> - The complete durable operation log
/// 404: () - The requested session does not exist
///
/// # Metadata
///
/// @tag agent
#[rovo]
pub async fn get_session(
    State(state): State<AppState>,
    Path(AgentSessionPath { session_id }): Path<AgentSessionPath>,
) -> impl IntoApiResponse {
    get_session_impl(state, session_id).await.into_response()
}

async fn get_session_impl(
    state: AppState,
    session_id: String,
) -> Result<impl IntoResponse, AppError> {
    match state.ai_sessions.get(&session_id) {
        Some(session) => Ok(Json(session)),
        None => Err(AppError::NotFound("The AI session does not exist".into())),
    }
}

/// Persist image metadata and create a short-lived direct S3 upload URL.
///
/// The session is created when necessary, but stays untitled until a user
/// prompt is actually submitted.
///
/// # Path Parameters
/// session_id: String - Opaque conversation ID that owns the attachment
///
/// # Responses
/// 200: Json<PreparedAgentAttachment> - Durable attachment metadata and a direct upload URL
/// 400: () - Invalid metadata or image storage configuration
///
/// # Metadata
/// @tag agent
#[rovo]
pub async fn prepare_attachment(
    State(state): State<AppState>,
    Path(AgentSessionPath { session_id }): Path<AgentSessionPath>,
    Json(request): Json<PrepareAgentAttachment>,
) -> impl IntoApiResponse {
    prepare_attachment_impl(state, session_id, request)
        .await
        .into_response()
}

async fn prepare_attachment_impl(
    state: AppState,
    session_id: String,
    request: PrepareAgentAttachment,
) -> Result<Json<PreparedAgentAttachment>, AppError> {
    let session = state.ai_session(session_id);
    session
        .prepare_attachment(request)
        .await
        .map(Json)
        .map_err(attachment_app_error)
}

/// Verify an uploaded object and make the attachment available to a session.
///
/// # Path Parameters
/// session_id: String - Opaque conversation ID that owns the attachment
/// attachment_id: String - Opaque attachment ID returned by prepare
///
/// # Responses
/// 200: Json<CompletedAgentAttachment> - The durable uploaded attachment
/// 400: () - The upload is missing, mismatched, or invalid
///
/// # Metadata
/// @tag agent
#[rovo]
pub async fn complete_attachment(
    State(state): State<AppState>,
    Path(AgentAttachmentPath {
        session_id,
        attachment_id,
    }): Path<AgentAttachmentPath>,
    Json(request): Json<CompleteAgentAttachment>,
) -> impl IntoApiResponse {
    complete_attachment_impl(state, session_id, attachment_id, request)
        .await
        .into_response()
}

async fn complete_attachment_impl(
    state: AppState,
    session_id: String,
    attachment_id: String,
    request: CompleteAgentAttachment,
) -> Result<Json<CompletedAgentAttachment>, AppError> {
    let session = state.ai_session(session_id);
    session
        .complete_attachment(attachment_id, request)
        .await
        .map(Json)
        .map_err(attachment_app_error)
}

/// Tombstone an unsent attachment and remove its object-store payload.
///
/// # Path Parameters
/// session_id: String - Opaque conversation ID that owns the attachment
/// attachment_id: String - Opaque attachment ID returned by prepare
///
/// # Responses
/// 204: () - The attachment was abandoned
/// 400: () - The attachment cannot be abandoned
///
/// # Metadata
/// @tag agent
#[rovo]
pub async fn abandon_attachment(
    State(state): State<AppState>,
    Path(AgentAttachmentPath {
        session_id,
        attachment_id,
    }): Path<AgentAttachmentPath>,
) -> impl IntoApiResponse {
    abandon_attachment_impl(state, session_id, attachment_id)
        .await
        .into_response()
}

async fn abandon_attachment_impl(
    state: AppState,
    session_id: String,
    attachment_id: String,
) -> Result<axum::http::StatusCode, AppError> {
    let session = state.ai_session(session_id);
    session
        .abandon_attachment(attachment_id)
        .await
        .map(|_| axum::http::StatusCode::NO_CONTENT)
        .map_err(attachment_app_error)
}

/// Redirect to a short-lived object-store URL for one uploaded attachment.
///
/// # Path Parameters
/// session_id: String - Opaque conversation ID that owns the attachment
/// attachment_id: String - Opaque attachment ID returned by prepare
///
/// # Responses
/// 307: () - Redirect to the short-lived object-store URL
///
/// # Metadata
/// @tag agent
#[rovo]
pub async fn download_attachment(
    State(state): State<AppState>,
    Path(AgentAttachmentPath {
        session_id,
        attachment_id,
    }): Path<AgentAttachmentPath>,
) -> impl IntoApiResponse {
    let session = state.ai_session(session_id);
    match session.attachment_download_url(attachment_id).await {
        Ok(url) => Redirect::temporary(&url).into_response(),
        Err(error) => attachment_app_error(error).into_response(),
    }
}

/// Preserve actionable diagnostics in server logs while keeping object-store,
/// filesystem, and session internals out of the browser response.
fn attachment_app_error(error: anyhow::Error) -> AppError {
    tracing::error!(%error, "AI session attachment request failed");
    AppError::String("Could not process the attachment. Please try again.".into())
}

#[cfg(test)]
mod tests {
    use super::{OpenAiModel, OpenAiModelsResponse, models_endpoint, normalize_models};

    #[test]
    fn model_endpoint_preserves_the_configured_api_path() {
        assert_eq!(
            models_endpoint("https://models.example.test/v1")
                .unwrap()
                .as_str(),
            "https://models.example.test/v1/models"
        );
    }

    #[test]
    fn normalizes_and_sorts_upstream_models() {
        let models = normalize_models(OpenAiModelsResponse {
            data: vec![
                OpenAiModel {
                    id: "z-model".into(),
                },
                OpenAiModel { id: "".into() },
                OpenAiModel {
                    id: "a-model".into(),
                },
            ],
        });
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["a-model", "z-model"]
        );
    }
}
