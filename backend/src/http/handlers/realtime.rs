use axum::extract::{Extension, State};
use axum::Json;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;

use super::require_auth;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttWsInfo {
    pub url: String,
    pub username: String,
    pub password: String,
    pub presence_topic: String,
}

pub async fn mqtt_config(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<MqttWsInfo>> {
    require_auth(&current)?;
    let mqtt = state
        .config
        .mqtt
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Realtime MQTT belum dikonfigurasi".into()))?;
    let (scheme, port) = if mqtt.use_tls {
        ("wss", 8084)
    } else {
        ("ws", 8083)
    };
    let username = state
        .config
        .mqtt_ws_username
        .clone()
        .unwrap_or_else(|| mqtt.username.clone());
    let password = state
        .config
        .mqtt_ws_password
        .clone()
        .unwrap_or_else(|| mqtt.password.clone());
    Ok(Json(MqttWsInfo {
        url: format!("{scheme}://{}:{port}/mqtt", mqtt.host),
        username,
        password,
        presence_topic: format!("{}/stations/+/presence", mqtt.topic_prefix),
    }))
}
