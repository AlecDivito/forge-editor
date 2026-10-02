mod actors;
mod agent;
mod config;
mod debug;
mod error;
mod models;
mod routes;
mod services;
mod state;
mod util;
mod utils;

use axum::{
    extract::State,
    http::{Method, StatusCode, header},
};
use rovo::{Router, aide::openapi::OpenApi, routing::get, rovo};
use tower_http::cors::{AllowOrigin, CorsLayer};

use std::net::SocketAddr;
use std::{error::Error, time::Duration};
use tower_http::trace::{DefaultMakeSpan, TraceLayer};
use tokio::net::TcpListener;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::routes::{fs_router, livez, readyz, metrics, ws_router};
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

    let _ = dotenvy::dotenv();
    let config = Config::new()?;
    let listener = TcpListener::bind(SocketAddr::new(config.bind_address, config.port))
        .await
        .unwrap();
    let cors_allowed_origin = config.cors_allowed_origin.clone();
    let state = AppState::new(config)?;
    // Watchers are intentionally retained in main: dropping a notify watcher
    // immediately unregisters its operating-system subscriptions.
    let _workspace_watchers = services::workspace_watcher::start(state.clone())?;

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::exact(cors_allowed_origin))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE]);

    let mut api = OpenApi::default();
    api.info.title = "Code Server API".to_string();
    api.info.description = Some("OpenAPI document for code server".to_string());

    let app = Router::<AppState>::new()
        .route("/livez", get(livez))
        .route("/readyz", get(readyz))
        .route("/metrics", get(metrics))
        .nest("/api", fs_router(state.clone()))
        .nest("/ws", ws_router(state.clone()))
        .with_oas(api)
        .with_swagger("/")
        .with_state(state.clone())
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
    .with_graceful_shutdown(shutdown_signal(state))
    .await?;

    // TODO: When we do a client disconnection, we normally need to unsubscribe from
    // open documents. Well, when the server is turning off, we also need to then
    // fully unsubscribe everyone manually, then we need to settle all changes and
    // finally we need to do a final backup (using rsync) to our backend store.

    Ok(())
}

async fn shutdown_signal(state: AppState) {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => tracing::info!("received interrupt signal"),
            _ = terminate.recv() => tracing::info!("received SIGTERM"),
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("install interrupt handler");
        tracing::info!("received interrupt signal");
    }
    state.begin_shutdown(Duration::from_secs(25)).await;
}
