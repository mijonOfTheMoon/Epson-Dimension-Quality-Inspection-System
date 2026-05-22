use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;

use super::require_auth;

#[derive(Debug, Deserialize)]
pub struct LoginBody {
    username: String,
    password: String,
}

pub async fn login(State(state): State<AppState>, Json(body): Json<LoginBody>) -> AppResult<Json<crate::auth::service::LoginResult>> {
    if body.username.trim().is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest("Invalid request".into()));
    }
    match state.auth.login(&body.username, &body.password).await? {
        Some(result) => Ok(Json(result)),
        None => Err(AppError::UnauthorizedMessage("Invalid credentials".into())),
    }
}

pub async fn me(Extension(current): Extension<CurrentUser>) -> AppResult<Json<crate::domain::SafeUser>> {
    Ok(Json(require_auth(&current)?))
}

pub async fn logout(Extension(current): Extension<CurrentUser>) -> AppResult<StatusCode> {
    require_auth(&current)?;
    Ok(StatusCode::NO_CONTENT)
}
