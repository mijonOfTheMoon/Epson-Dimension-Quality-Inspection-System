use axum::Json;

use crate::http::response::{health as health_response, HealthResponse};

pub async fn health() -> Json<HealthResponse> {
    Json(health_response())
}
