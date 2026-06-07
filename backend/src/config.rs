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
    pub database_pool_acquire_timeout: Duration,
    pub timezone: String,
    pub jwt_secret: String,
    pub jwt_expires_in: String,
    pub bcrypt_rounds: u32,
    pub agent_token: String,
    pub mqtt: Option<MqttConfig>,
    pub mqtt_ws_username: Option<String>,
    pub mqtt_ws_password: Option<String>,
    pub cloudflare_realtime: Option<CloudflareRealtimeConfig>,
    pub object_store: Option<ObjectStoreConfig>,
}

#[derive(Debug, Clone)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub topic_prefix: String,
    pub use_tls: bool,
    pub retained_presence_timeout: Duration,
    pub presence_stale_after: Duration,
}

#[derive(Debug, Clone)]
pub struct CloudflareRealtimeConfig {
    pub app_id: String,
    pub app_secret: String,
    pub api_base_url: String,
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
            value => {
                return Err(anyhow!(
                    "NODE_ENV must be development, test, or production, got {value}"
                ))
            }
        };

        let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is required")?;
        let jwt_secret = env_or(
            "JWT_SECRET",
            "change-me-in-production-please-use-long-secret",
        );
        if jwt_secret.len() < 16 {
            return Err(anyhow!("JWT_SECRET must contain at least 16 characters"));
        }
        let agent_token = env_or("AGENT_TOKEN", "change-me-agent-shared-token");
        if agent_token.len() < 8 {
            return Err(anyhow!("AGENT_TOKEN must contain at least 8 characters"));
        }
        let mqtt = mqtt_config(&node_env)?;
        let mqtt_ws_username = optional_env("MQTT_WS_USERNAME");
        let mqtt_ws_password = optional_env("MQTT_WS_PASSWORD");
        let cloudflare_realtime = cloudflare_realtime_config()?;
        let object_store = object_store_config()?;
        let timezone = validate_timezone(env_or("APP_TIMEZONE", "Asia/Jakarta"))?;

        Ok(Self {
            node_env,
            host: env_or("HOST", "0.0.0.0"),
            port: parse_env("PORT", 4000)?,
            log_level: env_or("LOG_LEVEL", "info"),
            cors_origin: env_or("CORS_ORIGIN", "*"),
            database_url,
            database_ssl: parse_bool_env("DATABASE_SSL", false)?,
            database_pool_max: parse_env("DATABASE_POOL_MAX", 10)?,
            database_pool_acquire_timeout: Duration::from_secs(parse_env(
                "DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS",
                30_u64,
            )?),
            timezone,
            jwt_secret,
            jwt_expires_in: env_or("JWT_EXPIRES_IN", "7d"),
            bcrypt_rounds: parse_env("BCRYPT_ROUNDS", 10)?,
            agent_token,
            mqtt,
            mqtt_ws_username,
            mqtt_ws_password,
            cloudflare_realtime,
            object_store,
        })
    }
}

fn mqtt_config(node_env: &NodeEnv) -> anyhow::Result<Option<MqttConfig>> {
    let host = env_or("MQTT_HOST", "");
    if host.trim().is_empty() {
        return Ok(None);
    }

    let username = require_env("MQTT_USERNAME")?;
    let password = require_env("MQTT_PASSWORD")?;
    let default_prefix = format!(
        "diminspect/{}",
        match node_env {
            NodeEnv::Development => "development",
            NodeEnv::Test => "test",
            NodeEnv::Production => "production",
        }
    );
    let topic_prefix = env_or("MQTT_TOPIC_PREFIX", &default_prefix)
        .trim()
        .trim_matches('/')
        .to_string();
    if topic_prefix.is_empty() {
        return Err(anyhow!(
            "MQTT_TOPIC_PREFIX must not be empty when MQTT_HOST is set"
        ));
    }

    Ok(Some(MqttConfig {
        host,
        port: parse_env("MQTT_PORT", 8883)?,
        username,
        password,
        topic_prefix,
        use_tls: parse_bool_env("MQTT_USE_TLS", true)?,
        retained_presence_timeout: Duration::from_millis(parse_env(
            "MQTT_RETAINED_PRESENCE_TIMEOUT_MS",
            2_000_u64,
        )?),
        presence_stale_after: Duration::from_millis(parse_env(
            "MQTT_PRESENCE_STALE_AFTER_MS",
            15_000_u64,
        )?),
    }))
}

fn cloudflare_realtime_config() -> anyhow::Result<Option<CloudflareRealtimeConfig>> {
    if !parse_bool_env("CLOUDFLARE_REALTIME_ENABLED", false)? {
        return Ok(None);
    }

    Ok(Some(CloudflareRealtimeConfig {
        app_id: require_env("CLOUDFLARE_REALTIME_APP_ID")?,
        app_secret: require_env("CLOUDFLARE_REALTIME_APP_SECRET")?,
        api_base_url: env_or(
            "CLOUDFLARE_REALTIME_API_BASE_URL",
            "https://rtc.live.cloudflare.com/v1",
        )
        .trim_end_matches('/')
        .to_string(),
    }))
}

fn object_store_config() -> anyhow::Result<Option<ObjectStoreConfig>> {
    if !parse_bool_env("OBJECT_STORE_ENABLED", false)? {
        return Ok(None);
    }

    let bucket = env_or("OBJECT_STORE_BUCKET", "diminspect-frames");
    if bucket.trim().is_empty() {
        return Err(anyhow!(
            "OBJECT_STORE_BUCKET must not be empty when OBJECT_STORE_ENABLED=true"
        ));
    }
    let account_id = require_env("OBJECT_STORE_ACCOUNT_ID")?;
    let access_key_id = require_env("OBJECT_STORE_ACCESS_KEY_ID")?;
    let secret_access_key = require_env("OBJECT_STORE_SECRET_ACCESS_KEY")?;

    let signed_url_ttl = parse_env("OBJECT_STORE_SIGNED_URL_TTL_SECONDS", 86_400_u64)?;
    validate_signed_url_ttl(signed_url_ttl)?;
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

const SIGNED_URL_TTL_MIN_SECONDS: u64 = 60;
const SIGNED_URL_TTL_MAX_SECONDS: u64 = 604_800;

fn validate_signed_url_ttl(ttl: u64) -> anyhow::Result<()> {
    if !(SIGNED_URL_TTL_MIN_SECONDS..=SIGNED_URL_TTL_MAX_SECONDS).contains(&ttl) {
        return Err(anyhow!(
            "OBJECT_STORE_SIGNED_URL_TTL_SECONDS must be between 60 and 604800 seconds"
        ));
    }
    Ok(())
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn optional_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn require_env(key: &str) -> anyhow::Result<String> {
    let value = std::env::var(key).with_context(|| format!("{key} is required"))?;
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(anyhow!("{key} must not be empty"));
    }
    Ok(value)
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

fn validate_timezone(value: String) -> anyhow::Result<String> {
    let valid = value.chars().enumerate().all(|(index, ch)| {
        if index == 0 {
            ch.is_ascii_alphabetic()
        } else {
            ch.is_ascii_alphanumeric() || matches!(ch, '_' | '+' | '-' | '/')
        }
    });

    if value.is_empty() || !valid {
        return Err(anyhow!(
            "APP_TIMEZONE must match ^[A-Za-z][A-Za-z0-9_+\\-/]*$"
        ));
    }

    Ok(value)
}
