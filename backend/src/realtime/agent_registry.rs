use serde::Serialize;

use crate::domain::{DimensionSpec, DimensionView};

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
    pub command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<AgentPartPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator: Option<AgentOperatorPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inspection_view: Option<DimensionView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<AgentVideoPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVideoPayload {
    pub provider: &'static str,
    pub enabled: bool,
    pub app_id: String,
    pub api_base_url: String,
    pub track_name: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentCommandType {
    Start,
    Stop,
    Capture,
    Recalibrate,
    Shutdown,
}
