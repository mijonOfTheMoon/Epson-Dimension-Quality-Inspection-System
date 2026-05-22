use std::sync::Arc;

use crate::domain::validation::validate_ingest_event;
use crate::domain::*;
use crate::realtime::event_bus::EventBus;
use crate::storage::postgres::PostgresStore;
use crate::storage::DataStore;

#[derive(Clone)]
pub struct IngestionService {
    store: Arc<PostgresStore>,
    event_bus: Arc<EventBus>,
}

impl IngestionService {
    pub fn new(store: Arc<PostgresStore>, event_bus: Arc<EventBus>) -> Self {
        Self { store, event_bus }
    }

    pub async fn ingest(&self, event: IngestEvent) -> anyhow::Result<Option<IngestEvent>> {
        validate_ingest_event(&event).map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let events = match event {
            IngestEvent::Inspection(event) => split_inspection_objects(event),
            IngestEvent::Station(event) => vec![IngestEvent::Station(event)],
        };

        let mut first_saved = None;
        for item in events {
            let saved = self.store.ingest(item).await?;
            if let Some(saved) = saved {
                if first_saved.is_none() {
                    first_saved = Some(saved.clone());
                }
                self.event_bus.publish(saved)?;
            }
        }

        Ok(first_saved)
    }
}

fn split_inspection_objects(event: InspectionCreatedEvent) -> Vec<IngestEvent> {
    if event.detections.len() <= 1 {
        return vec![IngestEvent::Inspection(event)];
    }

    event.detections
        .iter()
        .map(|detection| {
            let mut item = event.clone();
            item.event_id = format!("{}-{}", event.event_id, detection.id);
            item.status = detection.status;
            item.confidence_score = detection.confidence_score;
            item.measurements = detection.measurements.clone();
            item.detections = vec![detection.clone()];
            IngestEvent::Inspection(item)
        })
        .collect()
}
