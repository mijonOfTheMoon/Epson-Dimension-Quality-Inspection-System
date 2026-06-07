use std::collections::HashMap;

use axum::extract::{Extension, Path, State};
use axum::Json;
use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

use crate::domain::{
    IngestEvent, StationEventType, StationPhase, StationState, StationStatusEvent,
};
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::realtime::agent_registry::{AgentCommand, AgentCommandType};
use crate::storage::DataStore;

use super::{require_auth, require_role, SETTINGS_ROLES};

pub async fn list(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<Vec<StationStatusEvent>>> {
    require_auth(&current)?;
    let mut stations = state.store.list_stations().await?;
    if let Some(mqtt) = &state.mqtt {
        let presences = mqtt.list_presence().await?;
        let mut index = stations
            .iter()
            .enumerate()
            .map(|(position, station)| (station.station_id.clone(), position))
            .collect::<HashMap<_, _>>();
        for presence in presences {
            let state = if presence.online {
                StationState::Online
            } else {
                StationState::Offline
            };
            if let Some(position) = index.get(&presence.station_id).copied() {
                let station = &mut stations[position];
                station.state = state;
                station.running = Some(presence.online && presence.running);
                station.phase = if presence.online {
                    presence.phase.or(station.phase)
                } else {
                    Some(StationPhase::Idle)
                };
                station.active_part_code = if presence.online {
                    presence
                        .active_part_code
                        .or(station.active_part_code.clone())
                } else {
                    None
                };
                station.detections = if presence.online && presence.running {
                    presence.detections
                } else {
                    None
                };
                station.timestamp = presence.updated_at.unwrap_or_else(iso_now);
            } else if presence.online {
                index.insert(presence.station_id.clone(), stations.len());
                stations.push(StationStatusEvent {
                    event_type: StationEventType::StationStatus,
                    event_id: format!("mqtt-presence-{}-{}", presence.station_id, Uuid::new_v4()),
                    station_id: presence.station_id,
                    timestamp: presence.updated_at.unwrap_or_else(iso_now),
                    state,
                    fps: None,
                    running: Some(presence.running),
                    phase: presence.phase.or(Some(StationPhase::Idle)),
                    active_part_code: presence.active_part_code,
                    is_active: Some(true),
                    detections: if presence.running {
                        presence.detections
                    } else {
                        None
                    },
                });
            }
        }
        stations.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    }
    Ok(Json(stations))
}

pub async fn delete_station(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(station_id): Path<String>,
) -> AppResult<Json<StationStatusEvent>> {
    require_role(&current, SETTINGS_ROLES)?;
    let command = AgentCommand {
        kind: AgentCommandType::Stop,
        command_id: Some(Uuid::new_v4().to_string()),
        issued_at: Some(iso_now()),
        part: None,
        operator: None,
        inspection_view: None,
        video: None,
    };
    if let Some(mqtt) = &state.mqtt {
        if let Ok(Some(presence)) = mqtt.retained_presence(&station_id).await {
            if presence.online {
                let _ = mqtt.publish_command(&station_id, &command).await;
            }
        }
    }
    let station = state
        .store
        .deactivate_station(&station_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Station tidak ditemukan".into()))?;
    let deactivated = state
        .ingestion
        .ingest(IngestEvent::Station(StationStatusEvent {
            event_type: StationEventType::StationStatus,
            event_id: format!("station-deactivated-{}-{}", station_id, Uuid::new_v4()),
            station_id,
            timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            state: StationState::Offline,
            fps: None,
            running: Some(false),
            phase: Some(StationPhase::Idle),
            active_part_code: None,
            is_active: Some(false),
            detections: None,
        }))
        .await?;
    match deactivated {
        Some(IngestEvent::Station(event)) => Ok(Json(event)),
        _ => Ok(Json(station)),
    }
}

fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
