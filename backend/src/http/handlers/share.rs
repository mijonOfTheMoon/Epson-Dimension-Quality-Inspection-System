use std::collections::HashMap;

use axum::extract::{Extension, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::{InspectionStatus, RecapFilters};
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::share;
use crate::storage::DataStore;

use super::{bad_request, require_auth};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareChannelsResponse {
    pub channels: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFiltersBody {
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub status: Option<InspectionStatus>,
    #[serde(default)]
    pub part_code: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRecapBody {
    pub channels: Vec<String>,
    #[serde(default)]
    pub email_recipients: Vec<String>,
    pub filters: ShareFiltersBody,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelResultDto {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRecapResponse {
    pub results: HashMap<String, ChannelResultDto>,
}

pub async fn channels(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<ShareChannelsResponse>> {
    require_auth(&current)?;
    let channels = share::available_channels(&state.config.share)
        .into_iter()
        .map(str::to_string)
        .collect();
    Ok(Json(ShareChannelsResponse { channels }))
}

pub async fn recap(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Json(body): Json<ShareRecapBody>,
) -> AppResult<Json<ShareRecapResponse>> {
    require_auth(&current)?;

    if body.channels.is_empty() {
        return Err(AppError::BadRequest("Pilih minimal satu channel".into()));
    }

    let filters = build_filters(body.filters)?;
    let recipients: Vec<String> = body
        .email_recipients
        .into_iter()
        .map(|email| email.trim().to_string())
        .filter(|email| is_valid_email(email))
        .collect();

    let recap = state
        .store
        .aggregate_recap(filters)
        .await
        .map_err(AppError::from)?;

    let client = reqwest::Client::new();
    let outcomes = share::dispatch(
        &client,
        &state.config.share,
        &recap,
        &body.channels,
        &recipients,
    )
    .await;

    let results = outcomes
        .into_iter()
        .map(|(channel, outcome)| {
            (
                channel,
                ChannelResultDto {
                    ok: outcome.ok,
                    error: outcome.error,
                },
            )
        })
        .collect();

    Ok(Json(ShareRecapResponse { results }))
}

fn build_filters(body: ShareFiltersBody) -> AppResult<RecapFilters> {
    let part_code = body
        .part_code
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "all");
    let search = body
        .search
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let from = parse_optional_datetime(body.from.as_deref())?;
    let to = parse_optional_datetime(body.to.as_deref())?;
    Ok(RecapFilters {
        search,
        status: body.status,
        part_code,
        from,
        to,
    })
}

fn parse_optional_datetime(value: Option<&str>) -> AppResult<Option<DateTime<Utc>>> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(raw) => DateTime::parse_from_rfc3339(raw)
            .map(|parsed| Some(parsed.with_timezone(&Utc)))
            .map_err(bad_request),
        None => Ok(None),
    }
}

fn is_valid_email(value: &str) -> bool {
    let mut parts = value.split('@');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(local), Some(domain), None) => {
            !local.is_empty()
                && !value.chars().any(char::is_whitespace)
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        }
        _ => false,
    }
}
