use std::collections::HashMap;

use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use futures_util::future::join_all;
use serde::Serialize;

use crate::domain::validation::validate_inspection;
use crate::domain::{IngestEvent, InspectionCreatedEvent, InspectionQuery};
use crate::error::{AppError, AppResult};
use crate::http::response::DuplicatedResponse;
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::storage::DataStore;

use super::{require_auth, require_role, APP_ROLES, INSPECTION_ROLES};

pub async fn list(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Query(query): Query<InspectionQuery>,
) -> AppResult<Json<Vec<InspectionCreatedEvent>>> {
    require_auth(&current)?;
    let inspections = state.store.list_inspections(query).await?;
    Ok(Json(inspections))
}

pub async fn get_detail(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(event_id): Path<String>,
) -> AppResult<Json<InspectionCreatedEvent>> {
    require_auth(&current)?;
    let inspection = state
        .store
        .find_inspection(&event_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Inspeksi tidak ditemukan".into()))?;

    let mut vec_inspections = vec![inspection];
    attach_frame_urls(&mut vec_inspections, state.object_store.clone()).await;
    let inspection = vec_inspections.into_iter().next().unwrap();

    Ok(Json(inspection))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Json(event): Json<InspectionCreatedEvent>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    require_role(&current, INSPECTION_ROLES)?;
    validate_inspection(&event)?;
    let saved = state.ingestion.ingest(IngestEvent::Inspection(event)).await?;
    match saved {
        Some(event) => Ok((StatusCode::CREATED, Json(serde_json::to_value(event)?))),
        None => Ok((StatusCode::ACCEPTED, Json(serde_json::to_value(DuplicatedResponse { duplicated: true })?))),
    }
}

pub async fn refresh_frame_url(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(event_id): Path<String>,
) -> AppResult<Json<FrameUrlResponse>> {
    require_role(&current, APP_ROLES)?;
    let object_store = state
        .object_store
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Frame storage tidak aktif".into()))?;
    let key = state
        .store
        .find_frame_object_key(&event_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Frame tidak tersedia".into()))?;

    Ok(Json(FrameUrlResponse {
        frame_url: object_store.signed_get_url(&key).await?,
    }))
}

async fn attach_frame_urls(
    inspections: &mut [InspectionCreatedEvent],
    object_store: Option<std::sync::Arc<crate::storage::object_store::R2Store>>,
) {
    let Some(object_store) = object_store else {
        return;
    };

    let tasks = inspections
        .iter()
        .filter_map(|inspection| {
            inspection
                .frame_object_key
                .clone()
                .map(|key| (inspection.event_id.clone(), key))
        })
        .map(|(event_id, key)| {
            let object_store = object_store.clone();
            async move {
                match object_store.signed_get_url(&key).await {
                    Ok(url) => Some((event_id, url)),
                    Err(error) => {
                        tracing::warn!(%event_id, %key, %error, "failed to sign frame URL");
                        None
                    }
                }
            }
        });

    let urls: HashMap<String, String> = join_all(tasks)
        .await
        .into_iter()
        .flatten()
        .collect();
    for inspection in inspections {
        if let Some(url) = urls.get(&inspection.event_id) {
            inspection.frame_url = Some(url.clone());
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameUrlResponse {
    pub frame_url: String,
}
