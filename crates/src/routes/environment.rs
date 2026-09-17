use axum::{Json, extract::State};
use rovo::{axum::IntoApiResponse, rovo};

use crate::{
    models::{EnvironmentSnapshot, PublicEnvironment, PublicWorkspace},
    state::AppState,
};

#[rovo]
pub async fn get_environment(State(state): State<AppState>) -> impl IntoApiResponse {
    Json(EnvironmentSnapshot {
        schema_version: 1,
        environment: PublicEnvironment {
            id: state.config.environment.id.clone(),
            name: state.config.environment.name.clone(),
        },
        workspaces: state
            .config
            .workspaces
            .iter()
            .map(|workspace| PublicWorkspace {
                id: workspace.id.clone(),
                name: workspace.name.clone(),
            })
            .collect(),
        default_workspace_id: state.config.default_workspace_id.clone(),
    })
}
