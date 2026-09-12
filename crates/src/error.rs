use axum::{
    extract::FromRequest,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use tokio::io;

// Create our own JSON extractor by wrapping `axum::Json`. This makes it easy to override the
// rejection and provide our own which formats errors to match our application.
//
// `axum::Json` responds with plain text if the input is invalid.
#[derive(FromRequest)]
#[from_request(via(axum::Json), rejection(AppError))]
struct AppJson<T>(T);

impl<T> IntoResponse for AppJson<T>
where
    axum::Json<T>: IntoResponse,
{
    fn into_response(self) -> Response {
        axum::Json(self.0).into_response()
    }
}

#[derive(Debug)]
pub enum AppError {
    String(String),
    Conflict(String),
    GenericError(anyhow::Error),
}

impl From<anyhow::Error> for AppError {
    fn from(rejection: anyhow::Error) -> Self {
        Self::GenericError(rejection)
    }
}

impl From<io::Error> for AppError {
    fn from(value: io::Error) -> Self {
        Self::GenericError(anyhow::format_err!("FS Error: {}", value))
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // How we want errors responses to be serialized
        #[derive(Serialize)]
        struct ErrorResponse {
            message: String,
        }

        let (status, message) = match &self {
            AppError::String(error) => (StatusCode::BAD_REQUEST, format!("{}", error)),
            AppError::Conflict(error) => (StatusCode::CONFLICT, format!("{}", error)),
            AppError::GenericError(error) => (StatusCode::BAD_REQUEST, format!("{}", error)),
        };
        let response = (status, AppJson(ErrorResponse { message })).into_response();
        // if let Some(err) = err {
        //     // Insert our error into the response, our logging middleware will use this.
        //     // By wrapping the error in an Arc we can use it as an Extension regardless of any inner types not deriving Clone.
        //     response.extensions_mut().insert(Arc::new(err));
        // }
        response
    }
}
