pub mod handlers;
pub mod response;
pub mod router;

use std::sync::Arc;

use crate::auth::AuthService;
use crate::config::Config;
use crate::ingestion::IngestionService;
use crate::realtime::agent_registry::AgentRegistry;
use crate::realtime::event_bus::EventBus;
use crate::realtime::frame_bus::FrameBus;
use crate::storage::postgres::PostgresStore;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub store: Arc<PostgresStore>,
    pub auth: Arc<AuthService>,
    pub ingestion: Arc<IngestionService>,
    pub event_bus: Arc<EventBus>,
    pub frame_bus: Arc<FrameBus>,
    pub agent_registry: Arc<AgentRegistry>,
}
