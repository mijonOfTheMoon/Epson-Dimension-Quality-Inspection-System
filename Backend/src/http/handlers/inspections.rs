use axum::extract::{Extension, Query, State};
use axum::http::StatusCode;
use axum::Json;

use crate::domain::validation::validate_inspection;
use crate::domain::{IngestEvent, InspectionCreatedEvent, InspectionQuery};
use crate::error::AppResult;
use crate::http::response::DuplicatedResponse;
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::storage::DataStore;

use super::{require_auth, require_role, APP_ROLES};

pub async fn list(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Query(query): Query<InspectionQuery>,
) -> AppResult<Json<Vec<InspectionCreatedEvent>>> {
    require_auth(&current)?;
    Ok(Json(state.store.list_inspections(query).await?))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Json(event): Json<InspectionCreatedEvent>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    require_role(&current, APP_ROLES)?;
    validate_inspection(&event)?;
    let saved = state.ingestion.ingest(IngestEvent::Inspection(event)).await?;
    match saved {
        Some(event) => Ok((StatusCode::CREATED, Json(serde_json::to_value(event)?))),
        None => Ok((StatusCode::ACCEPTED, Json(serde_json::to_value(DuplicatedResponse { duplicated: true })?))),
    }
}
