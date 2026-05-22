use axum::http::{HeaderMap, Uri};

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

pub fn extract_query_token(uri: &Uri) -> Option<String> {
    let query = uri.query()?;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == "token" || key == "access_token" {
            let decoded = urlencoding::decode(value).ok()?.trim().to_string();
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
    }
    None
}
