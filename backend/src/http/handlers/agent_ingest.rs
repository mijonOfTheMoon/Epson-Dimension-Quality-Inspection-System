use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use bytes::Bytes;

use crate::auth::extract::extract_bearer_token;
use crate::domain::{IngestEvent, InspectionCreatedEvent};
use crate::error::{AppError, AppResult};
use crate::http::response::DuplicatedResponse;
use crate::http::AppState;

use super::bad_request;

const INSPECTION_FIELD: &str = "inspection";
const EVENT_FIELD: &str = "event";
const SNAPSHOT_FIELD: &str = "snapshot";
const FRAME_FIELD: &str = "frame";
const PARENT_EVENT_FIELD: &str = "parentEventId";
const STATION_FIELD: &str = "stationId";
const CAPTURED_AT_FIELD: &str = "capturedAt";

pub async fn inspection(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    require_agent_token(&state, &headers)?;

    let mut event_json: Option<String> = None;
    let mut snapshot: Option<Bytes> = None;
    while let Some(field) = multipart.next_field().await.map_err(bad_request)? {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            EVENT_FIELD | INSPECTION_FIELD => {
                event_json = Some(field.text().await.map_err(bad_request)?);
            }
            SNAPSHOT_FIELD | FRAME_FIELD => {
                snapshot = Some(field.bytes().await.map_err(bad_request)?);
            }
            _ => {}
        }
    }

    let event_json = event_json.ok_or_else(|| {
        AppError::BadRequest("multipart field `inspection` atau `event` wajib diisi".into())
    })?;
    let event: InspectionCreatedEvent = serde_json::from_str(&event_json)
        .map_err(|error| AppError::BadRequest(format!("inspection JSON tidak valid: {error}")))?;

    let saved = state
        .ingestion
        .ingest_with_snapshot(IngestEvent::Inspection(Box::new(event)), snapshot)
        .await?;
    match saved {
        Some(event) => Ok((StatusCode::CREATED, Json(serde_json::to_value(event)?))),
        None => Ok((
            StatusCode::ACCEPTED,
            Json(serde_json::to_value(DuplicatedResponse {
                duplicated: true,
            })?),
        )),
    }
}

pub async fn inspection_frame(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> AppResult<StatusCode> {
    require_agent_token(&state, &headers)?;

    let mut parent_event_id: Option<String> = None;
    let mut station_id: Option<String> = None;
    let mut captured_at: Option<String> = None;
    let mut snapshot: Option<Bytes> = None;
    while let Some(field) = multipart.next_field().await.map_err(bad_request)? {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            PARENT_EVENT_FIELD => {
                parent_event_id = Some(field.text().await.map_err(bad_request)?);
            }
            STATION_FIELD => {
                station_id = Some(field.text().await.map_err(bad_request)?);
            }
            CAPTURED_AT_FIELD => {
                captured_at = Some(field.text().await.map_err(bad_request)?);
            }
            SNAPSHOT_FIELD | FRAME_FIELD => {
                snapshot = Some(field.bytes().await.map_err(bad_request)?);
            }
            _ => {}
        }
    }

    let parent_event_id = parent_event_id
        .ok_or_else(|| AppError::BadRequest("multipart field `parentEventId` wajib diisi".into()))?;
    let station_id = station_id
        .ok_or_else(|| AppError::BadRequest("multipart field `stationId` wajib diisi".into()))?;
    let captured_at = captured_at
        .ok_or_else(|| AppError::BadRequest("multipart field `capturedAt` wajib diisi".into()))?;
    let snapshot = snapshot
        .ok_or_else(|| AppError::BadRequest("multipart field `snapshot` wajib diisi".into()))?;

    state
        .ingestion
        .attach_frame(&parent_event_id, &station_id, &captured_at, snapshot)
        .await?;
    Ok(StatusCode::ACCEPTED)
}

fn require_agent_token(state: &AppState, headers: &HeaderMap) -> AppResult<()> {
    match extract_bearer_token(headers) {
        Some(token) if token == state.config.agent_token => Ok(()),
        _ => Err(AppError::Unauthorized),
    }
}
