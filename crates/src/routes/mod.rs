mod environment;
mod file_search;
mod file_system;
mod ws;

use rovo::{
    IntoNestRouter, Router,
    routing::{any, get, post},
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
        .with_state(state)
}

pub fn ws_router(state: AppState) -> impl IntoNestRouter<AppState> {
    Router::new().route("/editor", any(ws)).with_state(state)
}
