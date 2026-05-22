use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use dashmap::DashMap;
use serde::Serialize;
use tokio::sync::mpsc;

use crate::domain::{DimensionSpec, DimensionView};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub station_id: String,
    pub online: bool,
    pub running: bool,
    pub connected_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPartPayload {
    pub part_id: String,
    pub part_code: String,
    pub part_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    pub dimensions: Vec<DimensionSpec>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOperatorPayload {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommand {
    #[serde(rename = "type")]
    pub kind: AgentCommandType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<AgentPartPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator: Option<AgentOperatorPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inspection_view: Option<DimensionView>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentCommandType {
    Start,
    Stop,
    Capture,
    Recalibrate,
}

#[derive(Debug)]
pub enum RegistryMessage {
    Command(AgentCommand),
    Close { code: u16, reason: &'static str },
}

#[derive(Clone)]
struct AgentHandle {
    connection_id: String,
    tx: mpsc::UnboundedSender<RegistryMessage>,
    connected_at: String,
    running: Arc<AtomicBool>,
}

pub struct RegisteredAgent {
    pub connection_id: String,
    pub connected_at: String,
}

pub struct AgentRegistry {
    agents: DashMap<String, AgentHandle>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            agents: DashMap::new(),
        }
    }

    pub fn register(
        &self,
        station_id: &str,
        tx: mpsc::UnboundedSender<RegistryMessage>,
        connected_at: String,
    ) -> RegisteredAgent {
        if let Some(existing) = self.agents.get(station_id) {
            let _ = existing.tx.send(RegistryMessage::Close { code: 4001, reason: "replaced" });
        }

        let connection_id = uuid::Uuid::new_v4().to_string();
        let running = Arc::new(AtomicBool::new(false));
        self.agents.insert(
            station_id.to_string(),
            AgentHandle {
                connection_id: connection_id.clone(),
                tx,
                connected_at: connected_at.clone(),
                running: running.clone(),
            },
        );

        RegisteredAgent {
            connection_id,
            connected_at,
        }
    }

    pub fn unregister(&self, station_id: &str, connection_id: &str) -> bool {
        let Some(current) = self.agents.get(station_id) else {
            return false;
        };
        if current.connection_id != connection_id {
            return false;
        }
        drop(current);
        self.agents.remove(station_id).is_some()
    }

    pub fn set_running(&self, station_id: &str, running: bool) {
        if let Some(agent) = self.agents.get(station_id) {
            agent.running.store(running, Ordering::Relaxed);
        }
    }

    pub fn send(&self, station_id: &str, command: AgentCommand) -> bool {
        let Some(agent) = self.agents.get(station_id) else {
            return false;
        };
        agent.tx.send(RegistryMessage::Command(command)).is_ok()
    }

    pub fn list(&self) -> Vec<AgentInfo> {
        self.agents
            .iter()
            .map(|entry| AgentInfo {
                station_id: entry.key().clone(),
                online: true,
                running: entry.running.load(Ordering::Relaxed),
                connected_at: Some(entry.connected_at.clone()),
            })
            .collect()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}
