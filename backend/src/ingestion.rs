use std::sync::Arc;

use bytes::Bytes;

use crate::domain::validation::validate_ingest_event;
use crate::domain::*;
use crate::storage::object_store::{upload_with_retry, R2Store};
use crate::storage::postgres::PostgresStore;
use crate::storage::DataStore;

#[derive(Clone)]
pub struct IngestionService {
    store: Arc<PostgresStore>,
    object_store: Option<Arc<R2Store>>,
}

impl IngestionService {
    pub fn new(store: Arc<PostgresStore>, object_store: Option<Arc<R2Store>>) -> Self {
        Self {
            store,
            object_store,
        }
    }

    pub async fn ingest(&self, event: IngestEvent) -> anyhow::Result<Option<IngestEvent>> {
        self.ingest_with_snapshot(event, None).await
    }

    pub async fn ingest_with_snapshot(
        &self,
        event: IngestEvent,
        snapshot: Option<Bytes>,
    ) -> anyhow::Result<Option<IngestEvent>> {
        validate_ingest_event(&event).map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let (events, upload_context) = match event {
            IngestEvent::Station(event) => {
                let saved = self.store.upsert_station_status(event).await?;
                return Ok(Some(IngestEvent::Station(saved)));
            }
            IngestEvent::Inspection(event) => {
                let upload_context = Some((
                    event.event_id.clone(),
                    event.station_id.clone(),
                    event.timestamp.clone(),
                ));
                (split_inspection_objects(*event), upload_context)
            }
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
            }
        }

        if !saved_inspection_ids.is_empty() {
            if let (
                Some(jpeg),
                Some((parent_event_id, station_id, captured_at)),
                Some(object_store),
            ) = (snapshot, upload_context, self.object_store.clone())
            {
                let key = build_frame_key(&station_id, &parent_event_id, &captured_at);
                upload_with_retry(&object_store, &key, jpeg, 3).await?;
                let updated = self
                    .store
                    .mark_frame_uploaded(&saved_inspection_ids, &key)
                    .await?;
                if let Some(IngestEvent::Inspection(inspection)) = &mut first_saved {
                    inspection.frame_object_key = Some(key.clone());
                    inspection.frame_uploaded_at = Some(chrono::Utc::now().to_rfc3339());
                }
                tracing::info!(
                    %parent_event_id,
                    %station_id,
                    %key,
                    updated,
                    expected = saved_inspection_ids.len(),
                    "frame uploaded from agent HTTP ingest"
                );
            }
        }

        Ok(first_saved)
    }
}

fn split_inspection_objects(event: InspectionCreatedEvent) -> Vec<IngestEvent> {
    if event.detections.len() <= 1 {
        return vec![IngestEvent::Inspection(Box::new(event))];
    }

    event
        .detections
        .iter()
        .map(|detection| {
            let mut item = event.clone();
            item.event_id = format!("{}-{}", event.event_id, detection.id);
            item.status = detection.status;
            item.confidence_score = detection.confidence_score;
            item.measurements = detection.measurements.clone();
            item.detections = vec![detection.clone()];
            IngestEvent::Inspection(Box::new(item))
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
