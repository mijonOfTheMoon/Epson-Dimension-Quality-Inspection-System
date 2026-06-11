use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::cloudflare::SessionDescription;
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;

use super::{require_auth, APP_ROLES};

#[derive(Deserialize)]
pub struct VideoSocketQuery {
    pub token: Option<String>,
}

pub async fn publish_ws(
    State(state): State<AppState>,
    Path(station_id): Path<String>,
    Query(query): Query<VideoSocketQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if query.token.as_deref() != Some(state.config.agent_token.as_str()) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    ws.on_upgrade(move |socket| handle_publish(socket, state, station_id))
}

async fn handle_publish(mut socket: WebSocket, state: AppState, station_id: String) {
    let sender = state.video_hub.sender(&station_id);
    while let Some(Ok(message)) = socket.recv().await {
        match message {
            Message::Binary(data) => {
                let _ = sender.send(data);
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
}

pub async fn watch_ws(
    State(state): State<AppState>,
    Path(station_id): Path<String>,
    Query(query): Query<VideoSocketQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    let resolved = state
        .auth
        .resolve_user(query.token.as_deref())
        .await
        .ok()
        .flatten();
    if resolved.is_none() {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    ws.on_upgrade(move |socket| handle_watch(socket, state, station_id))
}

async fn handle_watch(mut socket: WebSocket, state: AppState, station_id: String) {
    let mut receiver = state.video_hub.subscribe(&station_id);
    loop {
        tokio::select! {
            frame = receiver.recv() => match frame {
                Ok(bytes) => {
                    if socket.send(Message::Binary(bytes)).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {}
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IceServer {
    pub urls: String,
}

#[derive(Serialize)]
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerSessionBody {
    pub session_description: SessionDescription,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullTrackBody {
    pub publisher_session_id: String,
    pub track_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenegotiateBody {
    pub session_description: SessionDescription,
}

pub async fn viewer_session(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(station_id): Path<String>,
    Json(body): Json<ViewerSessionBody>,
) -> AppResult<Json<ViewerSessionResponse>> {
    require_auth(&current)?;
    let cloudflare = state.cloudflare_realtime.as_ref().ok_or_else(|| {
        AppError::ServiceUnavailable("Cloudflare Realtime belum dikonfigurasi".into())
    })?;
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

    let viewer_session = cloudflare
        .create_session(
            &format!("viewer-{station_id}-{}", Uuid::new_v4()),
            body.session_description,
        )
        .await?;
    let viewer_session_id = viewer_session.session_id;

    Ok(Json(ViewerSessionResponse {
        station_id,
        provider: "cloudflare-realtime",
        app_id: cloudflare.app_id().to_string(),
        viewer_session_id: viewer_session_id.clone(),
        publisher_session_id,
        track_name,
        session_description: viewer_session.session_description,
        requires_immediate_renegotiation: false,
        renegotiate_path: format!(
            "/api/video/cloudflare/sessions/{}/renegotiate",
            urlencoding::encode(&viewer_session_id)
        ),
        ice_servers: vec![IceServer {
            urls: "stun:stun.cloudflare.com:3478".into(),
        }],
    }))
}

pub async fn pull_track(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(session_id): Path<String>,
    Json(body): Json<PullTrackBody>,
) -> AppResult<Json<crate::cloudflare::TracksResponse>> {
    require_auth(&current)?;
    let cloudflare = state.cloudflare_realtime.as_ref().ok_or_else(|| {
        AppError::ServiceUnavailable("Cloudflare Realtime belum dikonfigurasi".into())
    })?;
    let response = cloudflare
        .pull_track(&session_id, &body.publisher_session_id, &body.track_name)
        .await?;
    Ok(Json(response))
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
    let cloudflare = state.cloudflare_realtime.as_ref().ok_or_else(|| {
        AppError::ServiceUnavailable("Cloudflare Realtime belum dikonfigurasi".into())
    })?;
    let response = cloudflare
        .renegotiate(&session_id, body.session_description)
        .await?;
    Ok(Json(serde_json::to_value(response)?))
}
