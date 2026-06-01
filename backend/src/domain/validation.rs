use chrono::DateTime;

use crate::domain::types::*;
use crate::error::{AppError, AppResult, ValidationIssue};

pub fn validate_dimension_spec(value: &DimensionSpec) -> AppResult<()> {
    let mut issues = Vec::new();
    if value.id.trim().is_empty() {
        issues.push(issue("id", "String must contain at least 1 character(s)"));
    }
    if value.name.trim().is_empty() {
        issues.push(issue("name", "String must contain at least 1 character(s)"));
    }
    if value.unit.trim().is_empty() {
        issues.push(issue("unit", "String must contain at least 1 character(s)"));
    }
    if !(value.lower_limit <= value.nominal && value.nominal <= value.upper_limit) {
        issues.push(issue("nominal", "nominal harus berada di antara lowerLimit dan upperLimit"));
    }
    reject_issues(issues)
}

pub fn validate_inspection(event: &InspectionCreatedEvent) -> AppResult<()> {
    let mut issues = Vec::new();
    if event.event_id.trim().is_empty() {
        issues.push(issue("eventId", "String must contain at least 1 character(s)"));
    }
    if event.station_id.trim().is_empty() {
        issues.push(issue("stationId", "String must contain at least 1 character(s)"));
    }
    if DateTime::parse_from_rfc3339(&event.timestamp).is_err() {
        issues.push(issue("timestamp", "Invalid datetime"));
    }
    if event.part_name.trim().is_empty() {
        issues.push(issue("partName", "String must contain at least 1 character(s)"));
    }
    if event.part_code.trim().is_empty() {
        issues.push(issue("partCode", "String must contain at least 1 character(s)"));
    }
    if !(0.0..=100.0).contains(&event.confidence_score) {
        issues.push(issue("confidenceScore", "Number must be between 0 and 100"));
    }
    for (index, measurement) in event.measurements.iter().enumerate() {
        validate_measurement(measurement, &mut issues, &format!("measurements.{index}"));
    }
    for (index, detection) in event.detections.iter().enumerate() {
        validate_detection(detection, &mut issues, &format!("detections.{index}"));
    }
    reject_issues(issues)
}

pub fn validate_station(event: &StationStatusEvent) -> AppResult<()> {
    let mut issues = Vec::new();
    if event.event_id.trim().is_empty() {
        issues.push(issue("eventId", "String must contain at least 1 character(s)"));
    }
    if event.station_id.trim().is_empty() {
        issues.push(issue("stationId", "String must contain at least 1 character(s)"));
    }
    if DateTime::parse_from_rfc3339(&event.timestamp).is_err() {
        issues.push(issue("timestamp", "Invalid datetime"));
    }
    if event.fps.is_some_and(|fps| fps < 0.0) {
        issues.push(issue("fps", "Number must be greater than or equal to 0"));
    }
    reject_issues(issues)
}

pub fn validate_ingest_event(event: &IngestEvent) -> AppResult<()> {
    match event {
        IngestEvent::Inspection(event) => validate_inspection(event),
        IngestEvent::Station(event) => validate_station(event),
    }
}

fn validate_measurement(value: &Measurement, issues: &mut Vec<ValidationIssue>, path: &str) {
    if value.dimension_name.trim().is_empty() {
        issues.push(issue(&format!("{path}.dimensionName"), "String must contain at least 1 character(s)"));
    }
    if value.unit.trim().is_empty() {
        issues.push(issue(&format!("{path}.unit"), "String must contain at least 1 character(s)"));
    }
}

fn validate_detection(value: &ObjectDetection, issues: &mut Vec<ValidationIssue>, path: &str) {
    if value.id.trim().is_empty() {
        issues.push(issue(&format!("{path}.id"), "String must contain at least 1 character(s)"));
    }
    if value.label.trim().is_empty() {
        issues.push(issue(&format!("{path}.label"), "String must contain at least 1 character(s)"));
    }
    if value.bbox.x < 0.0 || value.bbox.y < 0.0 || value.bbox.width <= 0.0 || value.bbox.height <= 0.0 {
        issues.push(issue(&format!("{path}.bbox"), "Invalid bounding box"));
    }
    if value.bbox.width > 100.0 || value.bbox.height > 100.0 {
        issues.push(issue(&format!("{path}.bbox"), "Bounding box dimensions must be at most 100"));
    }
    if !(0.0..=100.0).contains(&value.confidence_score) {
        issues.push(issue(&format!("{path}.confidenceScore"), "Number must be between 0 and 100"));
    }
    for (index, measurement) in value.measurements.iter().enumerate() {
        validate_measurement(measurement, issues, &format!("{path}.measurements.{index}"));
    }
}

fn issue(path: &str, message: &str) -> ValidationIssue {
    ValidationIssue {
        path: path.to_string(),
        message: message.to_string(),
    }
}

fn reject_issues(issues: Vec<ValidationIssue>) -> AppResult<()> {
    if issues.is_empty() {
        Ok(())
    } else {
        Err(AppError::InvalidRequest(issues))
    }
}
