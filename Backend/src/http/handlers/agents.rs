use std::collections::HashSet;

use axum::extract::{Extension, Path, State};
use axum::Json;
use serde::Deserialize;

use crate::domain::DimensionView;
use crate::error::{AppError, AppResult};
use crate::http::response::CommandDeliveredResponse;
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::realtime::agent_registry::{
    AgentCommand, AgentCommandType, AgentInfo, AgentOperatorPayload, AgentPartPayload,
};
use crate::storage::DataStore;

use super::{require_auth, require_role, APP_ROLES};

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
    let active_station_ids: HashSet<String> = state
        .store
        .list_stations()
        .await?
        .into_iter()
        .map(|station| station.station_id)
        .collect();
    let agents = state
        .agent_registry
        .list()
        .into_iter()
        .filter(|agent| active_station_ids.contains(&agent.station_id))
        .collect();
    Ok(Json(agents))
}

pub async fn command(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(station_id): Path<String>,
    Json(body): Json<AgentCommandBody>,
) -> AppResult<Json<CommandDeliveredResponse>> {
    let auth_user = require_role(&current, APP_ROLES)?;
    let mut command = AgentCommand {
        kind: match body.command {
            AgentCommandBodyType::Start => AgentCommandType::Start,
            AgentCommandBodyType::Stop => AgentCommandType::Stop,
            AgentCommandBodyType::Capture => AgentCommandType::Capture,
            AgentCommandBodyType::Recalibrate => AgentCommandType::Recalibrate,
        },
        part: None,
        operator: None,
        inspection_view: None,
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
    } else if matches!(body.command, AgentCommandBodyType::Capture) {
        command.inspection_view = body.inspection_view;
    }

    let delivered = state.agent_registry.send(&station_id, command);
    if !delivered {
        return Err(AppError::NotFound("Agent offline".into()));
    }

    Ok(Json(CommandDeliveredResponse {
        station_id,
        command: body.command.as_response().to_string(),
        delivered: true,
    }))
}
