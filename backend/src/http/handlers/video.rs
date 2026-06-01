use axum::extract::{Extension, Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::cloudflare::SessionDescription;
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;

use super::{require_auth, APP_ROLES};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IceServer {
    pub urls: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerSessionResponse {
    pub station_id: String,
    pub provider: &'static str,
    pub app_id: String,
    pub viewer_session_id: String,
    pub publisher_session_id: String,
    pub track_name: String,
    pub session_description: Option<SessionDescription>,
    pub requires_immediate_renegotiation: bool,
    pub renegotiate_path: String,
    pub ice_servers: Vec<IceServer>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenegotiateBody {
    pub session_description: SessionDescription,
}

pub async fn viewer_session(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(station_id): Path<String>,
) -> AppResult<Json<ViewerSessionResponse>> {
    require_auth(&current)?;
    let cloudflare = state
        .cloudflare_realtime
        .as_ref()
        .ok_or_else(|| AppError::ServiceUnavailable("Cloudflare Realtime belum dikonfigurasi".into()))?;
    let mqtt = state
        .mqtt
        .as_ref()
        .ok_or_else(|| AppError::ServiceUnavailable("MQTT belum dikonfigurasi".into()))?;
    let presence = mqtt
        .retained_presence(&station_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Presence agent tidak ditemukan".into()))?;
    if !presence.online {
        return Err(AppError::NotFound("Agent offline".into()));
    }
    let publisher_session_id = presence
        .video_session_id
        .ok_or_else(|| AppError::NotFound("Video agent belum tersedia".into()))?;
    let track_name = presence
        .video_track_name
        .ok_or_else(|| AppError::NotFound("Track video agent belum tersedia".into()))?;

    let viewer_session_id = cloudflare
        .create_session(&format!("viewer-{station_id}-{}", Uuid::new_v4()))
        .await?;
    let tracks = cloudflare
        .pull_track(&viewer_session_id, &publisher_session_id, &track_name)
        .await?;

    Ok(Json(ViewerSessionResponse {
        station_id,
        provider: "cloudflare-realtime",
        app_id: cloudflare.app_id().to_string(),
        viewer_session_id: viewer_session_id.clone(),
        publisher_session_id,
        track_name,
        session_description: tracks.session_description,
        requires_immediate_renegotiation: tracks.requires_immediate_renegotiation,
        renegotiate_path: format!(
            "/api/video/cloudflare/sessions/{}/renegotiate",
            urlencoding::encode(&viewer_session_id)
        ),
        ice_servers: vec![IceServer {
            urls: "stun:stun.cloudflare.com:3478".into(),
        }],
    }))
}

pub async fn renegotiate(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(session_id): Path<String>,
    Json(body): Json<RenegotiateBody>,
) -> AppResult<Json<serde_json::Value>> {
    let user = require_auth(&current)?;
    if !APP_ROLES.contains(&user.role) {
        return Err(AppError::Forbidden);
    }
    let cloudflare = state
        .cloudflare_realtime
        .as_ref()
        .ok_or_else(|| AppError::ServiceUnavailable("Cloudflare Realtime belum dikonfigurasi".into()))?;
    let response = cloudflare
        .renegotiate(&session_id, body.session_description)
        .await?;
    Ok(Json(serde_json::to_value(response)?))
}
