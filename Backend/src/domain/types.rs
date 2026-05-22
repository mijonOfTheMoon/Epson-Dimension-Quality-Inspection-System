use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum InspectionStatus {
    #[serde(rename = "OK")]
    Ok,
    #[serde(rename = "NG")]
    Ng,
}

impl InspectionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "OK",
            Self::Ng => "NG",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MeasurementStatus {
    #[serde(rename = "OK")]
    Ok,
    #[serde(rename = "NG")]
    Ng,
    #[serde(rename = "UNREADABLE")]
    Unreadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Operator,
    Qc,
    Supervisor,
    Engineering,
    Admin,
    Vendor,
}

impl UserRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Operator => "operator",
            Self::Qc => "qc",
            Self::Supervisor => "supervisor",
            Self::Engineering => "engineering",
            Self::Admin => "admin",
            Self::Vendor => "vendor",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestStatus {
    NotRequested,
    Requested,
    InProgress,
    Shipped,
    Received,
}

impl RequestStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotRequested => "not_requested",
            Self::Requested => "requested",
            Self::InProgress => "in_progress",
            Self::Shipped => "shipped",
            Self::Received => "received",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StationPhase {
    Idle,
    Calibrating,
    Ready,
    Stabilizing,
    Locked,
}

impl StationPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Calibrating => "calibrating",
            Self::Ready => "ready",
            Self::Stabilizing => "stabilizing",
            Self::Locked => "locked",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DimensionView {
    Top,
    Side,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DimensionKind {
    Width,
    Length,
    Diameter,
    OuterDiameter,
    InnerDiameter,
    HoleDiameter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum InspectionTrigger {
    #[serde(rename = "manual")]
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InspectionEventType {
    #[serde(rename = "inspection.created")]
    InspectionCreated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StationEventType {
    #[serde(rename = "station.status")]
    StationStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub dimension_name: String,
    pub measured: f64,
    pub nominal: f64,
    pub upper_limit: f64,
    pub lower_limit: f64,
    pub unit: String,
    pub status: MeasurementStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDetection {
    pub id: String,
    pub label: String,
    pub bbox: BoundingBox,
    pub status: InspectionStatus,
    pub confidence_score: f64,
    pub measurements: Vec<Measurement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionCreatedEvent {
    #[serde(rename = "eventType")]
    pub event_type: InspectionEventType,
    pub event_id: String,
    pub station_id: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_id: Option<String>,
    pub part_name: String,
    pub part_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator_name: Option<String>,
    pub status: InspectionStatus,
    pub confidence_score: f64,
    pub measurements: Vec<Measurement>,
    #[serde(default)]
    pub detections: Vec<ObjectDetection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<InspectionTrigger>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationStatusEvent {
    #[serde(rename = "eventType")]
    pub event_type: StationEventType,
    pub event_id: String,
    pub station_id: String,
    pub timestamp: String,
    pub state: StationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub running: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<StationPhase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_part_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StationState {
    Online,
    Offline,
}

impl StationState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Online => "online",
            Self::Offline => "offline",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IngestEvent {
    Inspection(InspectionCreatedEvent),
    Station(StationStatusEvent),
}

impl IngestEvent {
    pub fn event_id(&self) -> &str {
        match self {
            Self::Inspection(event) => &event.event_id,
            Self::Station(event) => &event.event_id,
        }
    }

    pub fn event_type(&self) -> &'static str {
        match self {
            Self::Inspection(_) => "inspection.created",
            Self::Station(_) => "station.status",
        }
    }

    pub fn station_id(&self) -> &str {
        match self {
            Self::Inspection(event) => &event.station_id,
            Self::Station(event) => &event.station_id,
        }
    }

    pub fn timestamp(&self) -> &str {
        match self {
            Self::Inspection(event) => &event.timestamp,
            Self::Station(event) => &event.timestamp,
        }
    }
}

impl From<InspectionCreatedEvent> for IngestEvent {
    fn from(value: InspectionCreatedEvent) -> Self {
        Self::Inspection(value)
    }
}

impl From<StationStatusEvent> for IngestEvent {
    fn from(value: StationStatusEvent) -> Self {
        Self::Station(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartType {
    pub id: String,
    pub part_name: String,
    pub part_code: String,
    pub vendor: String,
    pub dimensions: Vec<DimensionSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionSpec {
    pub id: String,
    pub name: String,
    pub kind: DimensionKind,
    #[serde(default = "default_dimension_view")]
    pub view: DimensionView,
    pub nominal: f64,
    pub upper_limit: f64,
    pub lower_limit: f64,
    #[serde(default = "default_unit")]
    pub unit: String,
}

fn default_dimension_view() -> DimensionView {
    DimensionView::Top
}

fn default_unit() -> String {
    "mm".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub password: String,
    pub name: String,
    pub role: UserRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeUser {
    pub id: String,
    pub username: String,
    pub name: String,
    pub role: UserRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
}

impl From<User> for SafeUser {
    fn from(value: User) -> Self {
        Self {
            id: value.id,
            username: value.username,
            name: value.name,
            role: value.role,
            avatar: value.avatar,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusHistoryEntry {
    pub status: RequestStatus,
    pub timestamp: String,
    pub changed_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityTrackingRecord {
    pub id: String,
    pub date: String,
    pub part_code: String,
    pub part_name: String,
    pub vendor: String,
    pub total_scanned: i32,
    pub ng_count: i32,
    pub ng_rate: f64,
    pub request_status: RequestStatus,
    pub status_history: Vec<StatusHistoryEntry>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionQuery {
    pub limit: Option<i64>,
    pub status: Option<InspectionStatus>,
    pub part_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub total: i64,
    pub ok: i64,
    pub ng: i64,
    pub ng_rate: f64,
    pub daily_trend: Vec<DailyTrendPoint>,
    pub station_count: i64,
    pub active_station_count: i64,
    pub station_trend: Vec<StationTrendPoint>,
    pub part_pareto: Vec<PartParetoPoint>,
    pub measurement_drift: Vec<MeasurementDriftPoint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTrendPoint {
    pub date: String,
    pub ok: i64,
    pub ng: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationTrendPoint {
    pub station_id: String,
    pub ok: i64,
    pub ng: i64,
    pub ng_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartParetoPoint {
    pub part_code: String,
    pub part_name: String,
    pub ok: i64,
    pub ng: i64,
    pub total: i64,
    pub ng_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementDriftPoint {
    pub dimension_name: String,
    pub avg_measured: f64,
    pub nominal: f64,
    pub delta: f64,
    pub unit: String,
}
