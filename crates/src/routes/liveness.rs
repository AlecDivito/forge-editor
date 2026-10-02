use crate::state::AppState;
use axum::{extract::State, http::StatusCode};
use rovo::rovo;

#[rovo]
pub async fn livez(State(_state): State<AppState>) -> StatusCode {
    StatusCode::NO_CONTENT
}

#[rovo]
pub async fn readyz(State(state): State<AppState>) -> StatusCode {
    if state.is_ready() {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

#[rovo]
pub async fn metrics(State(state): State<AppState>) -> String {
    let ready = u8::from(state.is_ready());
    let version = env!("CARGO_PKG_VERSION");
    let revision = option_env!("FORGE_BUILD_REVISION").unwrap_or("unknown");
    format!(
        "# HELP forge_ready Whether Forge is accepting new work.\n# TYPE forge_ready gauge\nforge_ready {ready}\n# HELP forge_build_info Forge runtime build metadata.\n# TYPE forge_build_info gauge\nforge_build_info{{version=\"{version}\",revision=\"{revision}\"}} 1\n"
    )
}
