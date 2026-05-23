use std::sync::Arc;

use crate::domain::validation::validate_ingest_event;
use crate::domain::*;
use crate::realtime::event_bus::EventBus;
use crate::realtime::frame_bus::FrameBus;
use crate::storage::object_store::{upload_with_retry, R2Store};
use crate::storage::postgres::PostgresStore;
use crate::storage::DataStore;

#[derive(Clone)]
pub struct IngestionService {
    store: Arc<PostgresStore>,
    event_bus: Arc<EventBus>,
    frame_bus: Arc<FrameBus>,
    object_store: Option<Arc<R2Store>>,
}

impl IngestionService {
    pub fn new(
        store: Arc<PostgresStore>,
        event_bus: Arc<EventBus>,
        frame_bus: Arc<FrameBus>,
        object_store: Option<Arc<R2Store>>,
    ) -> Self {
        Self {
            store,
            event_bus,
            frame_bus,
            object_store,
        }
    }

    pub async fn ingest(&self, event: IngestEvent) -> anyhow::Result<Option<IngestEvent>> {
        validate_ingest_event(&event).map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let upload_context = match &event {
            IngestEvent::Inspection(event) => Some((
                event.event_id.clone(),
                event.station_id.clone(),
                event.timestamp.clone(),
            )),
            IngestEvent::Station(_) => None,
        };
        let events = match event {
            IngestEvent::Inspection(event) => split_inspection_objects(event),
            IngestEvent::Station(event) => vec![IngestEvent::Station(event)],
        };

        let mut first_saved = None;
        let mut saved_inspection_ids = Vec::new();
        for item in events {
            let saved = self.store.ingest(item).await?;
            if let Some(saved) = saved {
                if let IngestEvent::Inspection(inspection) = &saved {
                    saved_inspection_ids.push(inspection.event_id.clone());
                }
                if first_saved.is_none() {
                    first_saved = Some(saved.clone());
                }
                self.event_bus.publish(saved)?;
            }
        }

        if !saved_inspection_ids.is_empty() {
            if let (Some((parent_event_id, station_id, captured_at)), Some(object_store)) =
                (upload_context, self.object_store.clone())
            {
                self.spawn_upload_frame(
                    parent_event_id,
                    station_id,
                    captured_at,
                    saved_inspection_ids,
                    object_store,
                );
            }
        }

        Ok(first_saved)
    }

    fn spawn_upload_frame(
        &self,
        parent_event_id: String,
        station_id: String,
        captured_at: String,
        inspection_event_ids: Vec<String>,
        object_store: Arc<R2Store>,
    ) {
        let frame_bus = self.frame_bus.clone();
        let store = self.store.clone();
        tokio::spawn(async move {
            let Some(jpeg) = frame_bus.latest_raw(&station_id) else {
                tracing::debug!(%parent_event_id, %station_id, "no latest frame available for upload");
                return;
            };

            let key = build_frame_key(&station_id, &parent_event_id, &captured_at);
            match upload_with_retry(&object_store, &key, jpeg, 3).await {
                Ok(()) => match store.mark_frame_uploaded(&inspection_event_ids, &key).await {
                    Ok(updated) => {
                        let expected = inspection_event_ids.len();
                        tracing::info!(%parent_event_id, %station_id, %key, updated, expected, "frame uploaded");
                    }
                    Err(error) => {
                        tracing::warn!(%parent_event_id, %station_id, %key, %error, "failed to update frame metadata");
                    }
                },
                Err(error) => {
                    tracing::warn!(%parent_event_id, %station_id, %key, %error, "frame upload failed");
                }
            }
        });
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

fn build_frame_key(station_id: &str, event_id: &str, captured_at: &str) -> String {
    let date = captured_at.chars().take(10).collect::<String>();
    format!(
        "frames/{}/{}/{}.jpg",
        safe_key_segment(&date),
        safe_key_segment(station_id),
        safe_key_segment(event_id)
    )
}

fn safe_key_segment(value: &str) -> String {
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
