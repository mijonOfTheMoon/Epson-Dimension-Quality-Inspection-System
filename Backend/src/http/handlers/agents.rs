use axum::extract::{Extension, Path, State};
use axum::Json;
use chrono::{SecondsFormat, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::DimensionView;
use crate::error::{AppError, AppResult};
use crate::http::response::CommandDeliveredResponse;
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::realtime::agent_registry::{
    AgentCommand, AgentCommandType, AgentInfo, AgentOperatorPayload, AgentPartPayload,
    AgentVideoPayload,
};
use crate::storage::DataStore;

use super::{require_auth, require_role, INSPECTION_ROLES};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandBody {
    command: AgentCommandBodyType,
    part_code: Option<String>,
    inspection_view: Option<DimensionView>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentCommandBodyType {
    Start,
    Stop,
    Capture,
    Recalibrate,
}

impl AgentCommandBodyType {
    fn as_response(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Capture => "capture",
            Self::Recalibrate => "recalibrate",
        }
    }
}

pub async fn list(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<Vec<AgentInfo>>> {
    require_auth(&current)?;
    let Some(mqtt) = &state.mqtt else {
        return Ok(Json(Vec::new()));
    };
    let agents = mqtt.agent_infos().await?;
    Ok(Json(agents))
}

pub async fn command(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(station_id): Path<String>,
    Json(body): Json<AgentCommandBody>,
) -> AppResult<Json<CommandDeliveredResponse>> {
    let auth_user = require_role(&current, INSPECTION_ROLES)?;
    let command_id = Uuid::new_v4().to_string();
    let issued_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut command = AgentCommand {
        kind: match body.command {
            AgentCommandBodyType::Start => AgentCommandType::Start,
            AgentCommandBodyType::Stop => AgentCommandType::Stop,
            AgentCommandBodyType::Capture => AgentCommandType::Capture,
            AgentCommandBodyType::Recalibrate => AgentCommandType::Recalibrate,
        },
        command_id: Some(command_id.clone()),
        issued_at: Some(issued_at),
        part: None,
        operator: None,
        inspection_view: None,
        video: None,
    };

    if matches!(body.command, AgentCommandBodyType::Start) {
        let part_code = body
            .part_code
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("partCode wajib diisi saat start".into()))?;
        let part = state
            .store
            .find_part(part_code)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Part {part_code} tidak ditemukan")))?;
        command.part = Some(AgentPartPayload {
            part_id: part.id,
            part_code: part.part_code,
            part_name: part.part_name,
            vendor: Some(part.vendor),
            dimensions: part.dimensions,
        });
        command.operator = Some(AgentOperatorPayload {
            id: auth_user.id,
            name: auth_user.name,
        });
        command.inspection_view = Some(body.inspection_view.unwrap_or(DimensionView::Top));
        if let Some(cloudflare) = &state.config.cloudflare_realtime {
            command.video = Some(AgentVideoPayload {
                provider: "cloudflare-realtime",
                enabled: true,
                app_id: cloudflare.app_id.clone(),
                api_base_url: cloudflare.api_base_url.clone(),
                track_name: format!(
                    "station-{}-{}",
                    safe_track_segment(&station_id),
                    safe_track_segment(&command_id)
                ),
            });
        }
    } else if matches!(body.command, AgentCommandBodyType::Capture) {
        command.inspection_view = body.inspection_view;
    }

    let mqtt = state
        .mqtt
        .as_ref()
        .ok_or_else(|| AppError::ServiceUnavailable("MQTT belum dikonfigurasi".into()))?;
    let presence = mqtt
        .retained_presence(&station_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Agent offline".into()))?;
    if !presence.online {
        return Err(AppError::NotFound("Agent offline".into()));
    }
    mqtt.publish_command(&station_id, &command).await?;

    Ok(Json(CommandDeliveredResponse {
        station_id,
        command: body.command.as_response().to_string(),
        command_id,
        delivery: "published",
        delivered: true,
    }))
}

fn safe_track_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}
