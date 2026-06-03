use axum::http::HeaderMap;

pub fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("bearer ") {
                Some(trimmed[7..].trim().to_string())
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty())
}
