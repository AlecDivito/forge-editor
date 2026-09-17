mod debug;
mod environment;
mod file_search;
mod file_system;
mod git;
mod ws;

use rovo::{
    IntoNestRouter, Router,
    routing::{any, get, patch, post},
};

use crate::{
    routes::{
        environment::get_environment,
        file_search::{search_and_replace_files, search_file_names, search_files},
        file_system::{create_file, delete_file, rename_file, save_file},
        ws::ws,
    },
    state::AppState,
};

use file_system::list_files;

pub fn fs_router(state: AppState) -> impl IntoNestRouter<AppState> {
    Router::new()
        .route("/environment", get(get_environment))
        .route("/fs/list", get(list_files))
        // .route("/fs/open", post(open_file))
        // .route("/fs/close", post(close_file))
        .route("/fs/save", post(save_file))
        .route("/fs/create", post(create_file))
        .route("/fs/rename", post(rename_file))
        .route("/fs/delete", post(delete_file))
        .route("/fs/search", get(search_files))
        .route("/fs/files/search", get(search_file_names))
        .route("/fs/replace", post(search_and_replace_files))
        .route("/git/status", get(git::get_status))
        .route("/git/diff", get(git::get_diff))
        .route("/git/stage", post(git::stage))
        .route("/git/unstage", post(git::unstage))
        .route("/git/commit", post(git::commit))
        .route("/git/push", post(git::push))
        .route(
            "/workspaces/{workspace_id}/debug/configurations",
            get(debug::get_configurations),
        )
        .route(
            "/workspaces/{workspace_id}/debug/sessions",
            post(debug::create_session),
        )
        .route(
            "/workspaces/{workspace_id}/debug/breakpoints",
            get(debug::list_breakpoints).post(debug::create_breakpoint),
        )
        .route(
            "/workspaces/{workspace_id}/debug/breakpoints/{breakpoint_id}",
            patch(debug::update_breakpoint).delete(debug::delete_breakpoint),
        )
        .route(
            "/workspaces/{workspace_id}/debug/sessions/{session_id}",
            get(debug::get_session).delete(debug::stop_session),
        )
        .route(
            "/workspaces/{workspace_id}/debug/sessions/{session_id}/restart",
            post(debug::restart_session),
        )
        .with_state(state)
}

pub fn ws_router(state: AppState) -> impl IntoNestRouter<AppState> {
    Router::new().route("/editor", any(ws)).with_state(state)
}
