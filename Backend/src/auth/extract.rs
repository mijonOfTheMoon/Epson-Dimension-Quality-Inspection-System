use axum::http::{HeaderMap, Uri};

pub const WS_BEARER_PROTOCOL: &str = "diminspect.v1.bearer";

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

pub fn extract_subprotocol_token(headers: &HeaderMap) -> Option<String> {
    let value = headers
        .get(axum::http::header::SEC_WEBSOCKET_PROTOCOL)?
        .to_str()
        .ok()?;
    let mut parts = value
        .split(',')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty());
    if parts.next()? != WS_BEARER_PROTOCOL {
        return None;
    }
    let token = parts.next()?.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

pub fn extract_query_token(uri: &Uri) -> Option<String> {
    let query = uri.query()?;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == "token" || key == "access_token" {
            if let Some(decoded) = decode_query_value(value) {
                return Some(decoded);
            }
        }
    }
    None
}

pub fn decode_query_value(value: &str) -> Option<String> {
    urlencoding::decode(value)
        .ok()
        .map(|decoded| decoded.trim().to_string())
        .filter(|decoded| !decoded.is_empty())
}

pub fn decode_form_query_value(value: &str) -> Option<String> {
    let form_value = value.replace('+', " ");
    decode_query_value(&form_value)
}
