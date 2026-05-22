use axum::extract::{Extension, Path, State};
use axum::Json;
use serde::Deserialize;

use crate::domain::{QualityTrackingRecord, RequestStatus, UserRole};
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::storage::DataStore;

use super::require_auth;

#[derive(Debug, Deserialize)]
pub struct StatusUpdateBody {
    status: RequestStatus,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<Vec<QualityTrackingRecord>>> {
    require_auth(&current)?;
    Ok(Json(state.store.list_quality_records().await?))
}

pub async fn update_status(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(body): Json<StatusUpdateBody>,
) -> AppResult<Json<QualityTrackingRecord>> {
    let user = require_auth(&current)?;
    if !allowed_roles(body.status).contains(&user.role) {
        return Err(AppError::Forbidden);
    }

    let current_record = state
        .store
        .list_quality_records()
        .await?
        .into_iter()
        .find(|record| record.id == id)
        .ok_or_else(|| AppError::NotFound("Record not found".into()))?;

    if !can_transition(current_record.request_status, body.status) {
        return Err(AppError::BadRequest("Transisi status tidak valid".into()));
    }

    let record = state
        .store
        .update_quality_record_status(&id, body.status, &user.name)
        .await?
        .ok_or_else(|| AppError::NotFound("Record not found".into()))?;
    Ok(Json(record))
}

fn allowed_roles(status: RequestStatus) -> &'static [UserRole] {
    match status {
        RequestStatus::NotRequested => &[UserRole::Admin],
        RequestStatus::Requested => &[UserRole::Engineering, UserRole::Admin],
        RequestStatus::InProgress => &[UserRole::Vendor, UserRole::Admin],
        RequestStatus::Shipped => &[UserRole::Vendor, UserRole::Admin],
        RequestStatus::Received => &[UserRole::Engineering, UserRole::Admin],
    }
}

fn can_transition(current: RequestStatus, next: RequestStatus) -> bool {
    matches!(
        (current, next),
        (RequestStatus::NotRequested, RequestStatus::Requested)
            | (RequestStatus::Requested, RequestStatus::InProgress)
            | (RequestStatus::InProgress, RequestStatus::Shipped)
            | (RequestStatus::Shipped, RequestStatus::Received)
    )
}
