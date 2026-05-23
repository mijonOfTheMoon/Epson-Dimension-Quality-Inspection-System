use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{HeaderValue, Method, Request};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::Response;
use axum::routing::{delete, get, patch, post};
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::auth::extract::extract_bearer_token;
use crate::auth::AuthService;
use crate::config::Config;
use crate::domain::SafeUser;
use crate::http::handlers;
use crate::http::AppState;
use crate::ingestion::IngestionService;
use crate::realtime::agent_registry::AgentRegistry;
use crate::realtime::event_bus::EventBus;
use crate::realtime::frame_bus::FrameBus;
use crate::realtime::{ws_agent, ws_event, ws_frame};
use crate::storage::object_store::R2Store;
use crate::storage::postgres::PostgresStore;

pub fn build_router(config: Config, store: PostgresStore, object_store: Option<Arc<R2Store>>) -> Router {
    let store = Arc::new(store);
    let event_bus = Arc::new(EventBus::new(config.event_replay_limit));
    let frame_bus = Arc::new(FrameBus::new());
    let agent_registry = Arc::new(AgentRegistry::new());
    let auth = Arc::new(AuthService::new(config.clone(), store.clone()));
    let ingestion = Arc::new(IngestionService::new(
        store.clone(),
        event_bus.clone(),
        frame_bus.clone(),
        object_store.clone(),
    ));

    let state = AppState {
        config: config.clone(),
        store,
        auth,
        ingestion,
        event_bus,
        frame_bus,
        agent_registry,
        object_store,
    };

    Router::new()
        .route("/health", get(handlers::health::health))
        .route("/api/health", get(handlers::health::health))
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/auth/me", get(handlers::auth::me))
        .route("/api/auth/logout", post(handlers::auth::logout))
        .route("/api/dashboard/summary", get(handlers::dashboard::summary))
        .route("/api/inspections", get(handlers::inspections::list).post(handlers::inspections::create))
        .route("/api/inspections/{event_id}", get(handlers::inspections::get_detail))
        .route("/api/inspections/{event_id}/frame/refresh-url", post(handlers::inspections::refresh_frame_url))
        .route("/api/stations", get(handlers::stations::list))
        .route("/api/stations/{stationId}", delete(handlers::stations::delete_station))
        .route("/api/parts", get(handlers::parts::list).post(handlers::parts::create))
        .route("/api/parts/{id}", patch(handlers::parts::update).delete(handlers::parts::delete_part))
        .route("/api/users", get(handlers::users::list).post(handlers::users::create))
        .route("/api/users/{id}", patch(handlers::users::update).delete(handlers::users::delete_user))
        .route("/api/agents", get(handlers::agents::list))
        .route("/api/agents/{stationId}/command", post(handlers::agents::command))
        .route("/api/quality-records", get(handlers::quality_records::list))
        .route("/api/quality-records/{id}/status", patch(handlers::quality_records::update_status))
        .route("/ws", get(ws_event::ws_handler))
        .route("/ws/frames", get(ws_frame::ws_handler))
        .route("/ws/agent", get(ws_agent::ws_handler))
        .with_state(state.clone())
        .layer(CompressionLayer::new().br(true).deflate(true))
        .layer(TraceLayer::new_for_http().make_span_with(|request: &Request<Body>| {
            tracing::info_span!(
                "http_request",
                method = %request.method(),
                path = %request.uri().path()
            )
        }))
        .layer(cors_layer(&config))
        .layer(from_fn_with_state(state, attach_auth))
}

async fn attach_auth(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let token = extract_bearer_token(request.headers());
    let user = match state.auth.resolve_user(token.as_deref()).await {
        Ok(user) => user,
        Err(error) => {
            tracing::debug!(%error, "failed to resolve auth user");
            None
        }
    };
    request.extensions_mut().insert(CurrentUser(user));
    next.run(request).await
}

#[derive(Debug, Clone)]
pub struct CurrentUser(pub Option<SafeUser>);

fn cors_layer(config: &Config) -> CorsLayer {
    let base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::OPTIONS])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE]);

    if config.cors_origin == "*" {
        base.allow_origin(Any)
    } else {
        let origins = config
            .cors_origin
            .split(',')
            .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
            .collect::<Vec<_>>();
        base.allow_origin(origins)
    }
}
