use chrono::{SecondsFormat, Utc};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub timestamp: String,
}

pub fn health() -> HealthResponse {
    HealthResponse {
        status: "ok",
        timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    }
}

#[derive(Debug, Serialize)]
pub struct DuplicatedResponse {
    pub duplicated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDeliveredResponse {
    pub station_id: String,
    pub command: String,
    pub delivered: bool,
}
