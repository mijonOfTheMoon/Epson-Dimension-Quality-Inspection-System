use axum::extract::{Extension, Path, State};
use axum::Json;
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::domain::UserRole;
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::realtime::agent_registry::{AgentCommand, AgentCommandType};

use super::require_role;

const ADMIN_ONLY: &[UserRole] = &[UserRole::Admin];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRemovedResponse {
    pub station_id: String,
    pub removed: bool,
}

pub async fn delete_station(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(station_id): Path<String>,
) -> AppResult<Json<StationRemovedResponse>> {
    require_role(&current, ADMIN_ONLY)?;
    let mqtt = state
        .mqtt
        .as_ref()
        .ok_or_else(|| AppError::ServiceUnavailable("MQTT belum dikonfigurasi".into()))?;

    let command = AgentCommand {
        kind: AgentCommandType::Shutdown,
        command_id: Some(Uuid::new_v4().to_string()),
        issued_at: Some(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)),
        part: None,
        operator: None,
        inspection_view: None,
        video: None,
    };
    let _ = mqtt.publish_command(&station_id, &command).await;
    mqtt.clear_presence(&station_id).await?;

    Ok(Json(StationRemovedResponse {
        station_id,
        removed: true,
    }))
}
