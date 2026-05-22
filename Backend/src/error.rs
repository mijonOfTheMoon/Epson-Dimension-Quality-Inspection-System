use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Unauthorized")]
    Unauthorized,
    #[error("{0}")]
    UnauthorizedMessage(String),
    #[error("Forbidden")]
    Forbidden,
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("Invalid request")]
    InvalidRequest(Vec<ValidationIssue>),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Serialize)]
struct ErrorBody {
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    issues: Option<Vec<ValidationIssue>>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                ErrorBody { message: "Unauthorized".into(), issues: None },
            ),
            AppError::UnauthorizedMessage(message) => (
                StatusCode::UNAUTHORIZED,
                ErrorBody { message, issues: None },
            ),
            AppError::Forbidden => (
                StatusCode::FORBIDDEN,
                ErrorBody { message: "Forbidden".into(), issues: None },
            ),
            AppError::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                ErrorBody { message, issues: None },
            ),
            AppError::NotFound(message) => (
                StatusCode::NOT_FOUND,
                ErrorBody { message, issues: None },
            ),
            AppError::InvalidRequest(issues) => (
                StatusCode::BAD_REQUEST,
                ErrorBody { message: "Invalid request".into(), issues: Some(issues) },
            ),
            AppError::Internal(error) => {
                tracing::error!(error = %error, "internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ErrorBody { message: "Internal Server Error".into(), issues: None },
                )
            }
        };

        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        AppError::Internal(value.into())
    }
}

impl From<bcrypt::BcryptError> for AppError {
    fn from(value: bcrypt::BcryptError) -> Self {
        AppError::Internal(value.into())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        AppError::Internal(value.into())
    }
}
