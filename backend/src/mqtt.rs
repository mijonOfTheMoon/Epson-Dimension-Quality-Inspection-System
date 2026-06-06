use std::time::Duration;

use anyhow::{anyhow, Context};
use chrono::{DateTime, SecondsFormat, Utc};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, Transport};
use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use uuid::Uuid;

use crate::config::MqttConfig;
use crate::domain::StationPhase;
use crate::realtime::agent_registry::AgentInfo;

const PRESENCE_LIST_EMPTY_TIMEOUT: Duration = Duration::from_millis(500);
const PRESENCE_LIST_IDLE_TIMEOUT: Duration = Duration::from_millis(150);
const PRESENCE_LIST_POLL_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationPresence {
    pub station_id: String,
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub running: bool,
    #[serde(default)]
    pub phase: Option<StationPhase>,
    #[serde(default)]
    pub active_part_code: Option<String>,
    #[serde(default)]
    pub connected_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub video_session_id: Option<String>,
    #[serde(default)]
    pub video_track_name: Option<String>,
}

#[derive(Clone)]
pub struct MqttService {
    config: MqttConfig,
}

impl MqttService {
    pub fn new(config: MqttConfig) -> Self {
        Self { config }
    }

    pub fn command_topic(&self, station_id: &str) -> String {
        format!(
            "{}/stations/{}/commands",
            self.config.topic_prefix,
            safe_topic_segment(station_id)
        )
    }

    pub fn presence_topic(&self, station_id: &str) -> String {
        format!(
            "{}/stations/{}/presence",
            self.config.topic_prefix,
            safe_topic_segment(station_id)
        )
    }

    pub fn wildcard_presence_topic(&self) -> String {
        format!("{}/stations/+/presence", self.config.topic_prefix)
    }

    pub async fn retained_presence(
        &self,
        station_id: &str,
    ) -> anyhow::Result<Option<StationPresence>> {
        let topic = self.presence_topic(station_id);
        let (client, mut eventloop) = self.client("presence");
        client
            .subscribe(topic, QoS::AtLeastOnce)
            .await
            .context("failed to subscribe retained MQTT presence")?;

        let deadline = Instant::now() + self.config.retained_presence_timeout;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(remaining, eventloop.poll()).await {
                Ok(Ok(Event::Incoming(Packet::Publish(publish)))) => {
                    if publish.payload.is_empty() {
                        return Ok(None);
                    }
                    return parse_presence(&publish.payload)
                        .map(|presence| Some(self.apply_presence_freshness(presence)));
                }
                Ok(Ok(_)) => {}
                Ok(Err(error)) => {
                    return Err(anyhow!(error).context("failed while reading MQTT presence"))
                }
                Err(_) => break,
            }
        }
        Ok(None)
    }

    pub async fn list_presence(&self) -> anyhow::Result<Vec<StationPresence>> {
        let (client, mut eventloop) = self.client("presence-list");
        client
            .subscribe(self.wildcard_presence_topic(), QoS::AtLeastOnce)
            .await
            .context("failed to subscribe MQTT presence list")?;

        let mut presences = Vec::new();
        let empty_timeout = self
            .config
            .retained_presence_timeout
            .min(PRESENCE_LIST_EMPTY_TIMEOUT);
        let mut deadline = Instant::now() + empty_timeout;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(remaining.min(PRESENCE_LIST_POLL_TIMEOUT), eventloop.poll())
                .await
            {
                Ok(Ok(Event::Incoming(Packet::Publish(publish)))) => {
                    if publish.payload.is_empty() {
                        continue;
                    }
                    match parse_presence(&publish.payload) {
                        Ok(presence) => {
                            presences.push(self.apply_presence_freshness(presence));
                            deadline = Instant::now() + PRESENCE_LIST_IDLE_TIMEOUT;
                        }
                        Err(error) => {
                            tracing::warn!(topic = %publish.topic, %error, "invalid MQTT presence payload")
                        }
                    }
                }
                Ok(Ok(_)) => {}
                Ok(Err(error)) => {
                    return Err(anyhow!(error).context("failed while reading MQTT presence list"))
                }
                Err(_) => {}
            }
        }
        Ok(presences)
    }

    pub async fn publish_command<T>(&self, station_id: &str, payload: &T) -> anyhow::Result<()>
    where
        T: Serialize + ?Sized,
    {
        let topic = self.command_topic(station_id);
        let bytes = serde_json::to_vec(payload)?;
        let (client, mut eventloop) = self.client("command");
        client
            .publish(topic, QoS::AtLeastOnce, false, bytes)
            .await
            .context("failed to enqueue MQTT command")?;

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(remaining, eventloop.poll()).await {
                Ok(Ok(Event::Incoming(Packet::PubAck(_)))) => return Ok(()),
                Ok(Ok(_)) => {}
                Ok(Err(error)) => {
                    return Err(anyhow!(error).context("failed while publishing MQTT command"))
                }
                Err(_) => break,
            }
        }
        Err(anyhow!(
            "timed out waiting for MQTT command acknowledgement"
        ))
    }

    pub async fn agent_infos(&self) -> anyhow::Result<Vec<AgentInfo>> {
        let mut agents = self
            .list_presence()
            .await?
            .into_iter()
            .filter(|presence| presence.online)
            .map(|presence| AgentInfo {
                station_id: presence.station_id,
                online: presence.online,
                running: presence.running,
                connected_at: presence.connected_at,
            })
            .collect::<Vec<_>>();
        agents.sort_by(|a, b| a.station_id.cmp(&b.station_id));
        Ok(agents)
    }

    fn client(&self, purpose: &str) -> (AsyncClient, rumqttc::EventLoop) {
        let mut options = MqttOptions::new(
            format!("diminspect-backend-{}-{}", purpose, Uuid::new_v4()),
            self.config.host.clone(),
            self.config.port,
        );
        options.set_keep_alive(Duration::from_secs(10));
        options.set_credentials(self.config.username.clone(), self.config.password.clone());
        if self.config.use_tls {
            options.set_transport(Transport::tls_with_default_config());
        }
        AsyncClient::new(options, 16)
    }

    fn apply_presence_freshness(&self, mut presence: StationPresence) -> StationPresence {
        if is_stale(
            presence.updated_at.as_deref(),
            self.config.presence_stale_after,
        ) {
            presence.online = false;
            presence.running = false;
            presence.phase = Some(StationPhase::Idle);
            presence.active_part_code = None;
            presence.video_session_id = None;
            presence.video_track_name = None;
        }
        presence
    }
}

fn parse_presence(bytes: &[u8]) -> anyhow::Result<StationPresence> {
    let mut presence: StationPresence = serde_json::from_slice(bytes)?;
    if presence.updated_at.is_none() {
        presence.updated_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true));
    }
    Ok(presence)
}

fn is_stale(updated_at: Option<&str>, stale_after: Duration) -> bool {
    let Some(updated_at) = updated_at else {
        return false;
    };
    let Ok(parsed) = DateTime::parse_from_rfc3339(updated_at) else {
        return true;
    };
    match Utc::now()
        .signed_duration_since(parsed.with_timezone(&Utc))
        .to_std()
    {
        Ok(age) => age > stale_after,
        Err(_) => false,
    }
}

fn safe_topic_segment(value: &str) -> String {
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
