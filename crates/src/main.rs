mod actors;
mod config;
mod error;
mod models;
mod routes;
mod services;
mod state;
mod util;
mod utils;

use axum::http::{HeaderValue, Method, header};
use rovo::{Router, aide::openapi::OpenApi};
use tower_http::cors::{AllowOrigin, CorsLayer};

use std::error::Error;
use std::net::SocketAddr;
use tower_http::trace::{DefaultMakeSpan, TraceLayer};

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::routes::{fs_router, ws_router};
use crate::{config::Config, state::AppState};
use dotenvy;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                format!("{}=debug,tower_http=debug", env!("CARGO_CRATE_NAME")).into()
            }),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    dotenvy::dotenv()?;
    let config = Config::new()?;
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", config.port))
        .await
        .unwrap();
    let state = AppState::new(config);

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::exact(HeaderValue::from_static(
            "http://localhost:3000",
        )))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE]);

    let mut api = OpenApi::default();
    api.info.title = "Code Server API".to_string();
    api.info.description = Some("OpenAPI document for code server".to_string());

    let app = Router::new()
        .nest("/api", fs_router(state.clone()))
        .nest("/ws", ws_router(state.clone()))
        .with_oas(api)
        .with_swagger("/")
        .with_state(state)
        .finish()
        .layer(cors)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::default().include_headers(true)),
        );

    tracing::debug!("listening on {}", listener.local_addr().unwrap());
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    // TODO: When we do a client disconnection, we normally need to unsubscribe from
    // open documents. Well, when the server is turning off, we also need to then
    // fully unsubscribe everyone manually, then we need to settle all changes and
    // finally we need to do a final backup (using rsync) to our backend store.

    Ok(())
}
