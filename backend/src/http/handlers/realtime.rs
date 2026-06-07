use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Extension, State};
use axum::Json;
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;

use super::require_auth;

const TOKEN_TTL_SECONDS: u64 = 3600;

#[derive(Serialize)]
struct AclRule {
    permission: &'static str,
    action: &'static str,
    topic: String,
}

#[derive(Serialize)]
struct MqttJwtClaims {
    exp: u64,
    iat: u64,
    username: String,
    acl: Vec<AclRule>,
}

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
    let user = require_auth(&current)?;
    let mqtt = state
        .config
        .mqtt
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Realtime MQTT belum dikonfigurasi".into()))?;
    let secret = state
        .config
        .mqtt_jwt_secret
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Realtime MQTT JWT belum dikonfigurasi".into()))?;

    let (scheme, port) = if mqtt.use_tls {
        ("wss", 8084)
    } else {
        ("ws", 8083)
    };
    let presence_topic = format!("{}/stations/+/presence", mqtt.topic_prefix);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
        .as_secs();
    let username = format!("viewer-{}", user.id);
    let claims = MqttJwtClaims {
        exp: now + TOKEN_TTL_SECONDS,
        iat: now,
        username: username.clone(),
        acl: vec![AclRule {
            permission: "allow",
            action: "subscribe",
            topic: presence_topic.clone(),
        }],
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;

    Ok(Json(MqttWsInfo {
        url: format!("{scheme}://{}:{port}/mqtt", mqtt.host),
        username,
        password: token,
        presence_topic,
    }))
}
