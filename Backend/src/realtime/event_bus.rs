use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;
use tokio::sync::broadcast;

use crate::domain::IngestEvent;

pub struct EventBus {
    limit: usize,
    latest: Mutex<VecDeque<IngestEvent>>,
    tx: broadcast::Sender<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventEnvelope<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    event: &'a IngestEvent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotEnvelope<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    events: &'a [IngestEvent],
}

impl EventBus {
    pub fn new(limit: usize) -> Self {
        let (tx, _) = broadcast::channel(2048);
        Self {
            limit,
            latest: Mutex::new(VecDeque::with_capacity(limit)),
            tx,
        }
    }

    pub fn publish(&self, event: IngestEvent) -> anyhow::Result<()> {
        {
            let mut latest = self.latest.lock().expect("event bus lock poisoned");
            latest.push_back(event.clone());
            while latest.len() > self.limit {
                latest.pop_front();
            }
        }

        let text = serde_json::to_string(&EventEnvelope {
            kind: "event",
            event: &event,
        })?;
        let _ = self.tx.send(text);
        Ok(())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    pub fn snapshot(&self) -> anyhow::Result<String> {
        let events: Vec<IngestEvent> = self
            .latest
            .lock()
            .expect("event bus lock poisoned")
            .iter()
            .cloned()
            .collect();
        Ok(serde_json::to_string(&SnapshotEnvelope {
            kind: "snapshot",
            events: &events,
        })?)
    }
}
