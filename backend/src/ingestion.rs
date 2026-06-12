use std::sync::Arc;

use bytes::Bytes;

use crate::domain::validation::validate_ingest_event;
use crate::domain::*;
use crate::storage::object_store::{upload_with_retry, R2Store};
use crate::storage::postgres::PostgresStore;
use crate::storage::DataStore;
use crate::mqtt::MqttService;

#[derive(Clone)]
pub struct IngestionService {
    store: Arc<PostgresStore>,
    object_store: Option<Arc<R2Store>>,
    mqtt: Option<Arc<MqttService>>,
}

impl IngestionService {
    pub fn new(
        store: Arc<PostgresStore>,
        object_store: Option<Arc<R2Store>>,
        mqtt: Option<Arc<MqttService>>,
    ) -> Self {
        Self {
            store,
            object_store,
            mqtt,
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
        let IngestEvent::Inspection(event) = event;
        let event = *event;

        let parent_event_id = event.event_id.clone();
        let station_id = event.station_id.clone();
        let captured_at = event.timestamp.clone();
        let source_detections = event.detections.clone();
        let entries: Vec<InspectionCreatedEvent> = split_inspection_objects(event);
        verify_entries_consistent(&entries, &source_detections)?;

        if entries.is_empty() {
            return Ok(None);
        }

        let saved_ids = self.store.ingest_inspections_atomic(&entries).await?;
        if saved_ids.is_empty() {
            return Ok(None);
        }

        let first_saved = entries
            .iter()
            .find(|entry| saved_ids.contains(&entry.event_id))
            .cloned()
            .map(|entry| IngestEvent::Inspection(Box::new(entry)));

        if let Some(mqtt) = &self.mqtt {
            let payloads: Vec<Vec<u8>> = entries
                .iter()
                .filter(|entry| saved_ids.contains(&entry.event_id))
                .filter_map(|entry| serde_json::to_vec(entry).ok())
                .collect();
            if !payloads.is_empty() {
                let mqtt = mqtt.clone();
                let station = station_id.clone();
                tokio::spawn(async move {
                    if let Err(error) = mqtt.publish_inspections(&station, payloads).await {
                        tracing::warn!(%station, %error, "failed to publish inspection over MQTT");
                    }
                });
            }
        }

        if let (Some(jpeg), Some(object_store)) = (snapshot, self.object_store.clone()) {
            let key = build_frame_key(&station_id, &parent_event_id, &captured_at);
            let store = self.store.clone();
            let saved_for_upload = saved_ids.clone();
            tokio::spawn(async move {
                if let Err(error) = upload_with_retry(&object_store, &key, jpeg, 3).await {
                    tracing::error!(%station_id, %key, %error, "async frame upload failed");
                    return;
                }
                match store.mark_frame_uploaded(&saved_for_upload, &key).await {
                    Ok(updated) => tracing::info!(
                        %parent_event_id,
                        %station_id,
                        %key,
                        updated,
                        expected = saved_for_upload.len(),
                        "frame uploaded from agent HTTP ingest"
                    ),
                    Err(error) => {
                        tracing::error!(%parent_event_id, %key, %error, "mark frame uploaded failed")
                    }
                }
            });
        }

        Ok(first_saved)
    }

    pub async fn attach_frame(
        &self,
        parent_event_id: &str,
        station_id: &str,
        captured_at: &str,
        jpeg: Bytes,
    ) -> anyhow::Result<()> {
        let Some(object_store) = self.object_store.clone() else {
            return Ok(());
        };
        let key = build_frame_key(station_id, parent_event_id, captured_at);
        upload_with_retry(&object_store, &key, jpeg, 3).await?;
        let updated = self.store.mark_frame_uploaded_by_parent(parent_event_id, &key).await?;
        tracing::info!(%parent_event_id, %station_id, %key, updated, "frame attached from agent");
        Ok(())
    }
}

fn verify_entries_consistent(
    entries: &[InspectionCreatedEvent],
    detections: &[ObjectDetection],
) -> anyhow::Result<()> {
    if entries.len() != detections.len() {
        return Err(anyhow::anyhow!(
            "history entry count did not match the number of detected objects"
        ));
    }

    for (entry, detection) in entries.iter().zip(detections.iter()) {
        let carried = entry.detections.first();
        let consistent = entry.detections.len() == 1
            && entry.status == detection.status
            && entry.confidence_score == detection.confidence_score
            && measurements_equal(&entry.measurements, &detection.measurements)
            && carried
                .map(|carried| bbox_equal(&carried.bbox, &detection.bbox) && carried.id == detection.id)
                .unwrap_or(false)
            && entry.event_id.ends_with(&detection.id);
        if !consistent {
            return Err(anyhow::anyhow!(
                "history entry {} data was inconsistent with its detected object",
                entry.event_id
            ));
        }
    }

    Ok(())
}

fn measurements_equal(left: &[Measurement], right: &[Measurement]) -> bool {
    serde_json::to_value(left).ok() == serde_json::to_value(right).ok()
}

fn bbox_equal(left: &BoundingBox, right: &BoundingBox) -> bool {
    left.x == right.x && left.y == right.y && left.width == right.width && left.height == right.height
}

fn split_inspection_objects(event: InspectionCreatedEvent) -> Vec<InspectionCreatedEvent> {
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
            item
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
