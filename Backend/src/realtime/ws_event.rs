use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, Uri};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};

use crate::auth::extract::{
    extract_bearer_token, extract_query_token, extract_subprotocol_token, WS_BEARER_PROTOCOL,
};
use crate::http::AppState;
use crate::realtime::event_bus::EventBus;

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
    ws.protocols([WS_BEARER_PROTOCOL])
        .on_upgrade(move |socket| async move {
            let user = state.auth.resolve_user(token.as_deref()).await.ok().flatten();
            if user.is_none() {
                close(socket, 4003, "unauthorized").await;
                return;
            }
            handle_socket(socket, state.event_bus).await;
        })
}

async fn handle_socket(socket: WebSocket, event_bus: Arc<EventBus>) {
    let (mut sender, mut receiver) = socket.split();
    if let Ok(snapshot) = event_bus.snapshot() {
        if sender.send(Message::Text(snapshot.into())).await.is_err() {
            return;
        }
    }

    let mut rx = event_bus.subscribe();
    loop {
        tokio::select! {
            message = rx.recv() => {
                match message {
                    Ok(text) => {
                        if sender.send(Message::Text(text.into())).await.is_err() {
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
