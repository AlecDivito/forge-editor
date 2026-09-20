use std::time::Duration;

use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use rovo::{axum::IntoApiResponse, rovo, schemars::JsonSchema};
use serde::Deserialize;

use crate::{
    error::AppError,
    models::{AgentModelCatalog, AgentModelDescriptor, AiSession, AiSessionSummary},
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
    let endpoint = models_endpoint(&config.base_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::Upstream("The model client could not be initialized".into()))?;
    let response = client
        .get(endpoint)
        .bearer_auth(config.api_key())
        .send()
        .await
        .map_err(|_| {
            AppError::Upstream("The configured model backend could not be reached".into())
        })?;
    if !response.status().is_success() {
        return Err(AppError::Upstream(
            "The configured model backend rejected the model listing request".into(),
        ));
    }
    let payload = response.json::<OpenAiModelsResponse>().await.map_err(|_| {
        AppError::Upstream("The configured model backend returned an invalid model listing".into())
    })?;
    let models = normalize_models(payload);
    Ok(Json(AgentModelCatalog {
        configured: true,
        models,
    }))
}

fn models_endpoint(base_url: &str) -> Result<reqwest::Url, AppError> {
    let base_url = format!("{}/", base_url.trim_end_matches('/'));
    reqwest::Url::parse(&base_url)
        .and_then(|base_url| base_url.join("models"))
        .map_err(|_| AppError::Upstream("OPENAI_API_BASE_URL is invalid".into()))
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
/// 200: Json<AiSession> - The complete durable session
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
