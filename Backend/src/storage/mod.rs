pub mod postgres;
pub mod seed;

use async_trait::async_trait;

use crate::domain::*;

#[async_trait]
pub trait DataStore: Send + Sync {
    async fn init(&self) -> anyhow::Result<()>;
    async fn ingest(&self, event: IngestEvent) -> anyhow::Result<Option<IngestEvent>>;
    async fn list_inspections(&self, query: InspectionQuery) -> anyhow::Result<Vec<InspectionCreatedEvent>>;
    async fn list_stations(&self) -> anyhow::Result<Vec<StationStatusEvent>>;
    async fn deactivate_station(&self, station_id: &str) -> anyhow::Result<Option<StationStatusEvent>>;
    async fn list_parts(&self) -> anyhow::Result<Vec<PartType>>;
    async fn find_part(&self, part_code: &str) -> anyhow::Result<Option<PartType>>;
    async fn create_part(&self, input: PartInput) -> anyhow::Result<PartType>;
    async fn update_part(&self, id: &str, input: PartInput) -> anyhow::Result<Option<PartType>>;
    async fn delete_part(&self, id: &str) -> anyhow::Result<bool>;
    async fn list_users(&self) -> anyhow::Result<Vec<SafeUser>>;
    async fn find_user_by_username(&self, username: &str) -> anyhow::Result<Option<User>>;
    async fn find_user_by_id(&self, id: &str) -> anyhow::Result<Option<User>>;
    async fn create_user(&self, input: UserInput) -> anyhow::Result<SafeUser>;
    async fn update_user(&self, id: &str, input: UserUpdateInput) -> anyhow::Result<Option<SafeUser>>;
    async fn delete_user(&self, id: &str) -> anyhow::Result<bool>;
    async fn count_users_by_role(&self, role: UserRole) -> anyhow::Result<i64>;
    async fn list_quality_records(&self) -> anyhow::Result<Vec<QualityTrackingRecord>>;
    async fn update_quality_record_status(
        &self,
        id: &str,
        status: RequestStatus,
        changed_by: &str,
    ) -> anyhow::Result<Option<QualityTrackingRecord>>;
    async fn get_dashboard_summary(&self) -> anyhow::Result<DashboardSummary>;
}

#[derive(Debug, Clone)]
pub struct PartInput {
    pub part_name: String,
    pub part_code: String,
    pub vendor: String,
    pub dimensions: Vec<DimensionSpec>,
}

#[derive(Debug, Clone)]
pub struct UserInput {
    pub username: String,
    pub password: String,
    pub name: String,
    pub role: UserRole,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UserUpdateInput {
    pub username: String,
    pub password: Option<String>,
    pub name: String,
    pub role: UserRole,
    pub avatar: Option<String>,
}
