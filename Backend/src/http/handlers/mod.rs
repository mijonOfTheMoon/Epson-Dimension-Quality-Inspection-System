pub mod agents;
pub mod auth;
pub mod dashboard;
pub mod health;
pub mod inspections;
pub mod parts;
pub mod quality_records;
pub mod stations;
pub mod users;

use crate::domain::{SafeUser, UserRole};
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;

const APP_ROLES: &[UserRole] = &[
    UserRole::Operator,
    UserRole::Qc,
    UserRole::Supervisor,
    UserRole::Engineering,
    UserRole::Admin,
];
const INSPECTION_ROLES: &[UserRole] = &[
    UserRole::Operator,
    UserRole::Admin,
];
const SETTINGS_ROLES: &[UserRole] = &[
    UserRole::Qc,
    UserRole::Supervisor,
    UserRole::Engineering,
    UserRole::Admin,
];
const PART_MANAGER_ROLES: &[UserRole] = &[UserRole::Engineering, UserRole::Admin];
const USER_MANAGER_ROLES: &[UserRole] = &[UserRole::Admin];

fn require_auth(current: &CurrentUser) -> AppResult<SafeUser> {
    current.0.clone().ok_or(AppError::Unauthorized)
}

fn require_role(current: &CurrentUser, roles: &[UserRole]) -> AppResult<SafeUser> {
    let user = require_auth(current)?;
    if roles.contains(&user.role) {
        Ok(user)
    } else {
        Err(AppError::Forbidden)
    }
}

fn bad_request(error: impl std::fmt::Display) -> AppError {
    AppError::BadRequest(error.to_string())
}
