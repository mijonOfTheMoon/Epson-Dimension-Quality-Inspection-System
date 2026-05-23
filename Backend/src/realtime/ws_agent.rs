use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, Uri};
use axum::response::Response;
use chrono::{SecondsFormat, Utc};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;

use crate::auth::extract::{
    decode_form_query_value, decode_query_value, extract_bearer_token,
};
use crate::domain::*;
use crate::http::AppState;
use crate::ingestion::IngestionService;
use crate::realtime::agent_registry::{AgentRegistry, RegistryMessage};
use crate::realtime::frame_bus::FrameBus;

#[derive(Debug)]
struct StationQuery {
    station_id: String,
    legacy_alias: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    ws.on_upgrade(move |socket| async move {
        let token = extract_bearer_token(&headers);
        let config = state.config.clone();
        let Some(query) = station_query(&uri) else {
            close(socket, 4003, "unauthorized").await;
            return;
        };
        if token.as_deref() != Some(config.agent_token.as_str()) {
            close(socket, 4003, "unauthorized").await;
            return;
        }
        let StationQuery {
            station_id,
            legacy_alias,
        } = query;
        let legacy_aliases = legacy_station_aliases(&station_id, legacy_alias);
        handle_socket(
            socket,
            station_id,
            legacy_aliases,
            state.agent_registry,
            state.frame_bus,
            state.ingestion,
        )
        .await;
    })
}

async fn handle_socket(
    socket: WebSocket,
    station_id: String,
    legacy_aliases: Vec<String>,
    registry: Arc<AgentRegistry>,
    frame_bus: Arc<FrameBus>,
    ingestion: Arc<IngestionService>,
) {
    let connected_at = iso_now();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let registered = registry.register(&station_id, tx, connected_at.clone());

    tracing::info!(%station_id, "agent connected");
    let online_event = IngestEvent::Station(StationStatusEvent {
        event_type: StationEventType::StationStatus,
        event_id: format!("agent-online-{}-{}", station_id, Utc::now().timestamp_millis()),
        station_id: station_id.clone(),
        timestamp: registered.connected_at.clone(),
        state: StationState::Online,
        fps: None,
        running: Some(false),
        phase: None,
        active_part_code: None,
        is_active: Some(true),
    });
    if let Err(error) = ingestion.ingest(online_event).await {
        tracing::debug!(%station_id, %error, "failed to record agent online");
    }
    for alias in &legacy_aliases {
        deactivate_legacy_alias(alias, &frame_bus, &ingestion).await;
    }

    let (mut sender, mut receiver) = socket.split();
    loop {
        tokio::select! {
            outbound = rx.recv() => {
                match outbound {
                    Some(RegistryMessage::Command(command)) => {
                        match serde_json::to_string(&command) {
                            Ok(json) => {
                                if sender.send(Message::Text(json.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(error) => tracing::warn!(%station_id, %error, "failed to serialize agent command"),
                        }
                    }
                    Some(RegistryMessage::Close { code, reason }) => {
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame { code, reason: reason.into() }))).await;
                        break;
                    }
                    None => break,
                }
            }
            inbound = receiver.next() => {
                match inbound {
                    Some(Ok(Message::Binary(frame))) => {
                        if let Err(error) = frame_bus.publish(&station_id, frame) {
                            tracing::warn!(%station_id, %error, "frame publish failed");
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        let text_ref: &str = text.as_ref();
                        ingest_agent_text(&station_id, &registry, &ingestion, text_ref.as_bytes()).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        tracing::warn!(%station_id, %error, "agent socket error");
                        break;
                    }
                }
            }
        }
    }

    let removed = registry.unregister(&station_id, &registered.connection_id);
    if removed {
        frame_bus.forget(&station_id);
        let offline_event = IngestEvent::Station(StationStatusEvent {
            event_type: StationEventType::StationStatus,
            event_id: format!("agent-offline-{}-{}", station_id, Utc::now().timestamp_millis()),
            station_id: station_id.clone(),
            timestamp: iso_now(),
            state: StationState::Offline,
            fps: None,
            running: Some(false),
            phase: Some(StationPhase::Idle),
            active_part_code: None,
            is_active: None,
        });
        if let Err(error) = ingestion.ingest(offline_event).await {
            tracing::debug!(%station_id, %error, "failed to record agent offline");
        }
    }
    tracing::info!(%station_id, "agent disconnected");
}

async fn ingest_agent_text(
    station_id: &str,
    registry: &AgentRegistry,
    ingestion: &IngestionService,
    bytes: &[u8],
) {
    let mut event = match serde_json::from_slice::<IngestEvent>(bytes) {
        Ok(event) => event,
        Err(error) => {
            tracing::warn!(%station_id, %error, "agent message ingest failed");
            return;
        }
    };

    match &mut event {
        IngestEvent::Inspection(inspection) => {
            let payload_station_id = inspection.station_id.clone();
            if payload_station_id != station_id {
                tracing::warn!(
                    %station_id,
                    %payload_station_id,
                    "agent inspection station id overridden by websocket station id"
                );
                inspection.station_id = station_id.to_string();
            }
        }
        IngestEvent::Station(station) => {
            let payload_station_id = station.station_id.clone();
            if payload_station_id != station_id {
                tracing::warn!(
                    %station_id,
                    %payload_station_id,
                    "agent status station id overridden by websocket station id"
                );
                station.station_id = station_id.to_string();
            }
            registry.set_running(station_id, station.running.unwrap_or(false));
        }
    }

    if let Err(error) = ingestion.ingest(event).await {
        tracing::warn!(%station_id, %error, "agent message ingest failed");
    }
}

async fn deactivate_legacy_alias(
    legacy_alias: &str,
    frame_bus: &FrameBus,
    ingestion: &IngestionService,
) {
    frame_bus.forget(legacy_alias);
    let event = IngestEvent::Station(StationStatusEvent {
        event_type: StationEventType::StationStatus,
        event_id: format!(
            "agent-alias-deactivated-{}-{}",
            legacy_alias,
            Utc::now().timestamp_millis()
        ),
        station_id: legacy_alias.to_string(),
        timestamp: iso_now(),
        state: StationState::Offline,
        fps: None,
        running: Some(false),
        phase: Some(StationPhase::Idle),
        active_part_code: None,
        is_active: Some(false),
    });
    if let Err(error) = ingestion.ingest(event).await {
        tracing::debug!(%legacy_alias, %error, "failed to deactivate legacy station alias");
    }
}

fn legacy_station_aliases(station_id: &str, legacy_alias: Option<String>) -> Vec<String> {
    let mut aliases = Vec::new();
    if let Some(alias) = legacy_alias.filter(|alias| alias != station_id) {
        aliases.push(alias);
    }

    if station_id.contains(' ') {
        let plus_alias = station_id.replace(' ', "+");
        if plus_alias != station_id && !aliases.iter().any(|alias| alias == &plus_alias) {
            aliases.push(plus_alias);
        }
    }

    aliases
}

async fn close(mut socket: WebSocket, code: u16, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

fn station_query(uri: &Uri) -> Option<StationQuery> {
    let query = uri.query()?;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == "stationId" {
            if let Some(station_id) = decode_form_query_value(value) {
                let legacy_alias = decode_query_value(value).filter(|alias| alias != &station_id);
                return Some(StationQuery {
                    station_id,
                    legacy_alias,
                });
            }
        }
    }
    None
}

fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
