use axum::extract::{Extension, State};
use axum::Json;

use crate::domain::DashboardSummary;
use crate::error::AppResult;
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::storage::DataStore;

use super::require_auth;

pub async fn summary(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<DashboardSummary>> {
    require_auth(&current)?;
    Ok(Json(state.store.get_dashboard_summary().await?))
}
