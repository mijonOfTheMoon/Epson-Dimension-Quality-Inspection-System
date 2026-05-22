use chrono::Utc;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::domain::{SafeUser, UserRole};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthTokenPayload {
    pub sub: String,
    pub username: String,
    pub role: UserRole,
    pub name: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn sign(user: &SafeUser, secret: &str, expires_in: &str) -> anyhow::Result<String> {
    let now = Utc::now().timestamp();
    let exp = now + parse_expires_in(expires_in)?;
    let payload = AuthTokenPayload {
        sub: user.id.clone(),
        username: user.username.clone(),
        role: user.role,
        name: user.name.clone(),
        iat: now,
        exp,
    };
    Ok(encode(&Header::new(Algorithm::HS256), &payload, &EncodingKey::from_secret(secret.as_bytes()))?)
}

pub fn verify(token: &str, secret: &str) -> Option<AuthTokenPayload> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    decode::<AuthTokenPayload>(token, &DecodingKey::from_secret(secret.as_bytes()), &validation)
        .ok()
        .map(|data| data.claims)
}

fn parse_expires_in(value: &str) -> anyhow::Result<i64> {
    let trimmed = value.trim();
    let Some(last) = trimmed.chars().last() else {
        anyhow::bail!("JWT_EXPIRES_IN is empty");
    };
    let (number, multiplier) = match last {
        's' | 'S' => (&trimmed[..trimmed.len() - 1], 1),
        'm' | 'M' => (&trimmed[..trimmed.len() - 1], 60),
        'h' | 'H' => (&trimmed[..trimmed.len() - 1], 60 * 60),
        'd' | 'D' => (&trimmed[..trimmed.len() - 1], 60 * 60 * 24),
        _ => (trimmed, 1),
    };
    Ok(number.parse::<i64>()? * multiplier)
}
