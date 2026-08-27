mod file_system;
mod file_search;

use std::sync::Arc;


use rovo::{IntoNestRouter, Router, routing::{get, post}};

use crate::{routes::{file_search::{search_and_replace_files, search_files}, file_system::{create_file, delete_file, rename_file, save_file}}, state::AppState};

use file_system::{list_files};

pub fn fs_router(state: Arc<AppState>) -> impl IntoNestRouter<Arc<AppState>> {
    Router::new()
        .route("/fs/list", get(list_files))
        // .route("/fs/open", post(open_file))
        // .route("/fs/close", post(close_file))
        .route("/fs/save", post(save_file))
        .route("/fs/create", post(create_file))
        .route("/fs/rename", post(rename_file))
        .route("/fs/delete", post(delete_file))
        .route("/fs/search", get(search_files))
        .route("/fs/replace", post(search_and_replace_files))
        .with_state(state)
}
