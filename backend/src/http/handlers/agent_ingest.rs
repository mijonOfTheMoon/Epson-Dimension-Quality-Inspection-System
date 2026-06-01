use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use bytes::Bytes;

use crate::auth::extract::extract_bearer_token;
use crate::domain::{IngestEvent, InspectionCreatedEvent, StationStatusEvent};
use crate::error::{AppError, AppResult};
use crate::http::response::DuplicatedResponse;
use crate::http::AppState;

use super::bad_request;

const INSPECTION_FIELD: &str = "inspection";
const EVENT_FIELD: &str = "event";
const SNAPSHOT_FIELD: &str = "snapshot";
const FRAME_FIELD: &str = "frame";

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(event): Json<StationStatusEvent>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    require_agent_token(&state, &headers)?;
    let saved = state.ingestion.ingest(IngestEvent::Station(event)).await?;
    match saved {
        Some(event) => Ok((StatusCode::ACCEPTED, Json(serde_json::to_value(event)?))),
        None => Ok((StatusCode::ACCEPTED, Json(serde_json::to_value(DuplicatedResponse { duplicated: true })?))),
    }
}

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

    let event_json = event_json
        .ok_or_else(|| AppError::BadRequest("multipart field `inspection` atau `event` wajib diisi".into()))?;
    let event: InspectionCreatedEvent = serde_json::from_str(&event_json)
        .map_err(|error| AppError::BadRequest(format!("inspection JSON tidak valid: {error}")))?;

    let saved = state
        .ingestion
        .ingest_with_snapshot(IngestEvent::Inspection(event), snapshot)
        .await?;
    match saved {
        Some(event) => Ok((StatusCode::CREATED, Json(serde_json::to_value(event)?))),
        None => Ok((StatusCode::ACCEPTED, Json(serde_json::to_value(DuplicatedResponse { duplicated: true })?))),
    }
}

fn require_agent_token(state: &AppState, headers: &HeaderMap) -> AppResult<()> {
    match extract_bearer_token(headers) {
        Some(token) if token == state.config.agent_token => Ok(()),
        _ => Err(AppError::Unauthorized),
    }
}
