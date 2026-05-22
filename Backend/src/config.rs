use std::time::Duration;

use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeEnv {
    #[serde(rename = "development")]
    Development,
    #[serde(rename = "test")]
    Test,
    #[serde(rename = "production")]
    Production,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub node_env: NodeEnv,
    pub host: String,
    pub port: u16,
    pub log_level: String,
    pub cors_origin: String,
    pub database_url: String,
    pub database_ssl: bool,
    pub database_pool_max: u32,
    pub jwt_secret: String,
    pub jwt_expires_in: String,
    pub bcrypt_rounds: u32,
    pub agent_token: String,
    pub event_replay_limit: usize,
    pub object_store: Option<ObjectStoreConfig>,
}

#[derive(Debug, Clone)]
pub struct ObjectStoreConfig {
    pub bucket: String,
    pub account_id: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub signed_url_ttl: Duration,
    pub upload_timeout: Duration,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let node_env = match env_or("NODE_ENV", "development").as_str() {
            "development" => NodeEnv::Development,
            "test" => NodeEnv::Test,
            "production" => NodeEnv::Production,
            value => return Err(anyhow!("NODE_ENV must be development, test, or production, got {value}")),
        };

        let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is required")?;
        let jwt_secret = env_or("JWT_SECRET", "change-me-in-production-please-use-long-secret");
        if jwt_secret.len() < 16 {
            return Err(anyhow!("JWT_SECRET must contain at least 16 characters"));
        }
        let agent_token = env_or("AGENT_TOKEN", "change-me-agent-shared-token");
        if agent_token.len() < 8 {
            return Err(anyhow!("AGENT_TOKEN must contain at least 8 characters"));
        }
        let object_store = object_store_config()?;

        Ok(Self {
            node_env,
            host: env_or("HOST", "0.0.0.0"),
            port: parse_env("PORT", 4000)?,
            log_level: env_or("LOG_LEVEL", "info"),
            cors_origin: env_or("CORS_ORIGIN", "*"),
            database_url,
            database_ssl: parse_bool_env("DATABASE_SSL", false)?,
            database_pool_max: parse_env("DATABASE_POOL_MAX", 10)?,
            jwt_secret,
            jwt_expires_in: env_or("JWT_EXPIRES_IN", "7d"),
            bcrypt_rounds: parse_env("BCRYPT_ROUNDS", 10)?,
            agent_token,
            event_replay_limit: parse_env("EVENT_REPLAY_LIMIT", 100)?,
            object_store,
        })
    }
}

fn object_store_config() -> anyhow::Result<Option<ObjectStoreConfig>> {
    if !parse_bool_env("OBJECT_STORE_ENABLED", false)? {
        return Ok(None);
    }

    let bucket = env_or("OBJECT_STORE_BUCKET", "diminspect-frames");
    let account_id = env_or("OBJECT_STORE_ACCOUNT_ID", "");
    let access_key_id = env_or("OBJECT_STORE_ACCESS_KEY_ID", "");
    let secret_access_key = env_or("OBJECT_STORE_SECRET_ACCESS_KEY", "");
    if [bucket.as_str(), account_id.as_str(), access_key_id.as_str(), secret_access_key.as_str()]
        .iter()
        .any(|value| value.trim().is_empty())
    {
        return Ok(None);
    }

    let signed_url_ttl = parse_env("OBJECT_STORE_SIGNED_URL_TTL_SECONDS", 86_400_u64)?;
    let upload_timeout = parse_env("OBJECT_STORE_UPLOAD_TIMEOUT_SECONDS", 10_u64)?;
    Ok(Some(ObjectStoreConfig {
        bucket,
        account_id,
        access_key_id,
        secret_access_key,
        signed_url_ttl: Duration::from_secs(signed_url_ttl),
        upload_timeout: Duration::from_secs(upload_timeout),
    }))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn parse_env<T>(key: &str, default: T) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match std::env::var(key) {
        Ok(value) => value.parse().with_context(|| format!("{key} is invalid")),
        Err(_) => Ok(default),
    }
}

fn parse_bool_env(key: &str, default: bool) -> anyhow::Result<bool> {
    match std::env::var(key) {
        Ok(value) => match value.to_ascii_lowercase().as_str() {
            "true" | "1" => Ok(true),
            "false" | "0" => Ok(false),
            _ => Err(anyhow!("{key} must be boolean")),
        },
        Err(_) => Ok(default),
    }
}
