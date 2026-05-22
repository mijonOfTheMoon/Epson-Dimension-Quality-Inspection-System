use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::validation::validate_dimension_spec;
use crate::domain::{DimensionKind, DimensionSpec, DimensionView, PartType};
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::storage::{DataStore, PartInput};

use super::{bad_request, require_auth, require_role, PART_MANAGER_ROLES};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartBody {
    part_name: String,
    part_code: String,
    vendor: String,
    dimensions: Vec<DimensionBody>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DimensionBody {
    id: Option<String>,
    name: String,
    kind: DimensionKind,
    #[serde(default = "default_view")]
    view: DimensionView,
    nominal: f64,
    upper_limit: f64,
    lower_limit: f64,
    #[serde(default = "default_unit")]
    unit: String,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<Vec<PartType>>> {
    require_auth(&current)?;
    Ok(Json(state.store.list_parts().await?))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Json(body): Json<PartBody>,
) -> AppResult<(StatusCode, Json<PartType>)> {
    require_role(&current, PART_MANAGER_ROLES)?;
    let input = normalize_part_input(body)?;
    let part = state.store.create_part(input).await.map_err(bad_request)?;
    Ok((StatusCode::CREATED, Json(part)))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(body): Json<PartBody>,
) -> AppResult<Json<PartType>> {
    require_role(&current, PART_MANAGER_ROLES)?;
    let input = normalize_part_input(body)?;
    let part = state
        .store
        .update_part(&id, input)
        .await
        .map_err(bad_request)?
        .ok_or_else(|| AppError::NotFound("Part tidak ditemukan".into()))?;
    Ok(Json(part))
}

pub async fn delete_part(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    require_role(&current, PART_MANAGER_ROLES)?;
    let deleted = state.store.delete_part(&id).await.map_err(bad_request)?;
    if !deleted {
        return Err(AppError::NotFound("Part tidak ditemukan".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

fn normalize_part_input(body: PartBody) -> AppResult<PartInput> {
    if body.part_name.trim().is_empty() || body.part_code.trim().is_empty() || body.vendor.trim().is_empty() {
        return Err(AppError::BadRequest("Invalid request".into()));
    }
    if body.dimensions.is_empty() {
        return Err(AppError::BadRequest("Invalid request".into()));
    }

    let mut dimensions = Vec::with_capacity(body.dimensions.len());
    for dim in body.dimensions {
        let dimension = DimensionSpec {
            id: dim
                .id
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty())
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            name: dim.name,
            kind: dim.kind,
            view: dim.view,
            nominal: dim.nominal,
            upper_limit: dim.upper_limit,
            lower_limit: dim.lower_limit,
            unit: dim.unit,
        };
        validate_dimension_spec(&dimension)?;
        dimensions.push(dimension);
    }

    Ok(PartInput {
        part_name: body.part_name,
        part_code: body.part_code,
        vendor: body.vendor,
        dimensions,
    })
}

fn default_view() -> DimensionView {
    DimensionView::Top
}

fn default_unit() -> String {
    "mm".to_string()
}
