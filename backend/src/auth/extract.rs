use axum::http::HeaderMap;

pub fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            let trimmed = value.trim();
            let (prefix, token) = trimmed.split_at_checked(7)?;
            prefix
                .eq_ignore_ascii_case("bearer ")
                .then(|| token.trim().to_string())
        })
        .filter(|value| !value.is_empty())
}
