use std::time::Duration;

use anyhow::{anyhow, Context};
use chrono::{DateTime, SecondsFormat, Utc};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, Transport};
use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use uuid::Uuid;

use crate::config::MqttConfig;
use crate::domain::ObjectDetection;
use crate::domain::StationPhase;

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
    #[serde(default)]
    pub detections: Option<Vec<ObjectDetection>>,
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

    pub fn inspection_topic(&self, station_id: &str) -> String {
        format!(
            "{}/stations/{}/inspection",
            self.config.topic_prefix,
            safe_topic_segment(station_id)
        )
    }

    pub async fn publish_inspections(
        &self,
        station_id: &str,
        payloads: Vec<Vec<u8>>,
    ) -> anyhow::Result<()> {
        if payloads.is_empty() {
            return Ok(());
        }
        let topic = self.inspection_topic(station_id);
        let expected = payloads.len();
        let (client, mut eventloop) = self.client("inspection");
        for payload in payloads {
            client
                .publish(topic.clone(), QoS::AtLeastOnce, false, payload)
                .await
                .context("failed to enqueue MQTT inspection")?;
        }

        let mut acked = 0usize;
        let deadline = Instant::now() + Duration::from_secs(5);
        while acked < expected && Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(remaining, eventloop.poll()).await {
                Ok(Ok(Event::Incoming(Packet::PubAck(_)))) => acked += 1,
                Ok(Ok(_)) => {}
                Ok(Err(error)) => {
                    return Err(anyhow!(error).context("failed while publishing MQTT inspection"))
                }
                Err(_) => break,
            }
        }
        Ok(())
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

    pub async fn clear_presence(&self, station_id: &str) -> anyhow::Result<()> {
        let topic = self.presence_topic(station_id);
        let (client, mut eventloop) = self.client("clear-presence");
        client
            .publish(topic, QoS::AtLeastOnce, true, Vec::<u8>::new())
            .await
            .context("failed to clear MQTT presence")?;

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(remaining, eventloop.poll()).await {
                Ok(Ok(Event::Incoming(Packet::PubAck(_)))) => return Ok(()),
                Ok(Ok(_)) => {}
                Ok(Err(error)) => {
                    return Err(anyhow!(error).context("failed while clearing MQTT presence"))
                }
                Err(_) => break,
            }
        }
        Err(anyhow!(
            "timed out waiting for MQTT presence clear acknowledgement"
        ))
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
            presence.detections = None;
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
