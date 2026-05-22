use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::domain::{SafeUser, UserRole};
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::storage::{DataStore, UserInput, UserUpdateInput};

use super::{bad_request, require_role, USER_MANAGER_ROLES};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCreateBody {
    username: String,
    password: String,
    name: String,
    role: UserRole,
    avatar: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserUpdateBody {
    username: String,
    password: Option<String>,
    name: String,
    role: UserRole,
    avatar: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<Vec<SafeUser>>> {
    require_role(&current, USER_MANAGER_ROLES)?;
    Ok(Json(state.store.list_users().await?))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Json(body): Json<UserCreateBody>,
) -> AppResult<(StatusCode, Json<SafeUser>)> {
    require_role(&current, USER_MANAGER_ROLES)?;
    if body.username.trim().is_empty() || body.password.len() < 4 || body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Invalid request".into()));
    }
    let user = state
        .store
        .create_user(UserInput {
            username: body.username,
            password: body.password,
            name: body.name,
            role: body.role,
            avatar: body.avatar,
        })
        .await
        .map_err(bad_request)?;
    Ok((StatusCode::CREATED, Json(user)))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(body): Json<UserUpdateBody>,
) -> AppResult<Json<SafeUser>> {
    let auth_user = require_role(&current, USER_MANAGER_ROLES)?;
    if body.username.trim().is_empty() || body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Invalid request".into()));
    }
    if let Some(password) = body.password.as_ref() {
        if !password.is_empty() && password.len() < 4 {
            return Err(AppError::BadRequest("Invalid request".into()));
        }
    }

    let existing = state
        .store
        .find_user_by_id(&id)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    if auth_user.id == id && body.role != UserRole::Admin {
        return Err(AppError::BadRequest("Tidak boleh mencabut role admin dari diri sendiri".into()));
    }
    if existing.role == UserRole::Admin
        && body.role != UserRole::Admin
        && state.store.count_users_by_role(UserRole::Admin).await? <= 1
    {
        return Err(AppError::BadRequest("Admin terakhir tidak boleh diubah rolenya".into()));
    }

    let user = state
        .store
        .update_user(
            &id,
            UserUpdateInput {
                username: body.username,
                password: body.password.filter(|password| !password.is_empty()),
                name: body.name,
                role: body.role,
                avatar: body.avatar,
            },
        )
        .await
        .map_err(bad_request)?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;
    Ok(Json(user))
}

pub async fn delete_user(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let auth_user = require_role(&current, USER_MANAGER_ROLES)?;
    if auth_user.id == id {
        return Err(AppError::BadRequest("Tidak boleh menghapus user sendiri".into()));
    }
    let existing = state
        .store
        .find_user_by_id(&id)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;
    if existing.role == UserRole::Admin && state.store.count_users_by_role(UserRole::Admin).await? <= 1 {
        return Err(AppError::BadRequest("Admin terakhir tidak boleh dihapus".into()));
    }
    let deleted = state.store.delete_user(&id).await?;
    if !deleted {
        return Err(AppError::NotFound("User tidak ditemukan".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
