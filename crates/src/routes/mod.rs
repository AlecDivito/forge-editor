mod file_system;

use std::sync::Arc;


use rovo::{IntoNestRouter, Router, routing::{delete, get, post}};

use crate::{routes::file_system::{create_file, delete_file, rename_file, save_file}, state::AppState};

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
        .with_state(state)
}
