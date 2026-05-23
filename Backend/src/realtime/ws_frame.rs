use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, Uri};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};

use crate::auth::extract::{
    decode_form_query_value, extract_bearer_token, extract_query_token, extract_subprotocol_token,
    WS_BEARER_PROTOCOL,
};
use crate::http::AppState;
use crate::realtime::frame_bus::FrameBus;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let token = extract_bearer_token(&headers)
        .or_else(|| extract_subprotocol_token(&headers))
        .or_else(|| {
            let value = extract_query_token(&uri);
            if value.is_some() {
                tracing::warn!(
                    "ws auth via query token is deprecated; switch to Sec-WebSocket-Protocol"
                );
            }
            value
        });
    let requested_station = station_query(&uri);
    ws.protocols([WS_BEARER_PROTOCOL])
        .on_upgrade(move |socket| async move {
            let user = state.auth.resolve_user(token.as_deref()).await.ok().flatten();
            if user.is_none() {
                close(socket, 4003, "unauthorized").await;
                return;
            }
            handle_socket(socket, state.frame_bus, requested_station).await;
        })
}

async fn handle_socket(socket: WebSocket, frame_bus: Arc<FrameBus>, requested_station: Option<String>) {
    let (mut sender, mut receiver) = socket.split();
    if let Some(station_id) = requested_station.as_deref() {
        if let Some(latest) = frame_bus.latest(station_id) {
            if sender.send(Message::Binary(latest)).await.is_err() {
                return;
            }
        }
    }

    let mut rx = frame_bus.subscribe();
    loop {
        tokio::select! {
            message = rx.recv() => {
                match message {
                    Ok((station_id, packet)) => {
                        if requested_station.as_deref().is_some_and(|requested| requested != station_id) {
                            continue;
                        }
                        if sender.send(Message::Binary(packet)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: 1011,
                            reason: "lagged".into(),
                        }))).await;
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            inbound = receiver.next() => {
                if inbound.is_none() {
                    break;
                }
            }
        }
    }
}

async fn close(mut socket: WebSocket, code: u16, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

fn station_query(uri: &Uri) -> Option<String> {
    let query = uri.query()?;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == "stationId" {
            if let Some(decoded) = decode_form_query_value(value) {
                return Some(decoded);
            }
        }
    }
    None
}
