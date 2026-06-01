use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};

use crate::config::CloudflareRealtimeConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDescription {
    pub sdp: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackRequest<'a> {
    tracks: Vec<TrackObject<'a>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackObject<'a> {
    location: &'a str,
    session_id: &'a str,
    track_name: &'a str,
    kind: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenegotiateRequest {
    pub session_description: SessionDescription,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewSessionResponse {
    session_id: String,
    error_code: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracksResponse {
    #[serde(default)]
    pub requires_immediate_renegotiation: bool,
    #[serde(default)]
    pub session_description: Option<SessionDescription>,
    #[serde(default)]
    pub tracks: Vec<serde_json::Value>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenegotiateResponse {
    #[serde(default)]
    pub session_description: Option<SessionDescription>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
}

#[derive(Clone)]
pub struct CloudflareRealtimeClient {
    config: CloudflareRealtimeConfig,
    http: reqwest::Client,
}

impl CloudflareRealtimeClient {
    pub fn new(config: CloudflareRealtimeConfig) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
        }
    }

    pub fn app_id(&self) -> &str {
        &self.config.app_id
    }

    pub async fn create_session(&self, correlation_id: &str) -> anyhow::Result<String> {
        let url = format!(
            "{}/apps/{}/sessions/new?correlationId={}",
            self.config.api_base_url,
            self.config.app_id,
            urlencoding::encode(correlation_id)
        );
        let response = self
            .http
            .post(url)
            .bearer_auth(&self.config.app_secret)
            .json(&serde_json::json!({}))
            .send()
            .await
            .context("Cloudflare Realtime create session failed")?;
        let status = response.status();
        let body = response
            .json::<NewSessionResponse>()
            .await
            .context("Cloudflare Realtime create session response was invalid")?;
        if !status.is_success() || body.error_code.is_some() {
            return Err(anyhow!(
                "Cloudflare Realtime create session failed: {}",
                body.error_description
                    .or(body.error_code)
                    .unwrap_or_else(|| status.to_string())
            ));
        }
        Ok(body.session_id)
    }

    pub async fn pull_track(
        &self,
        viewer_session_id: &str,
        publisher_session_id: &str,
        track_name: &str,
    ) -> anyhow::Result<TracksResponse> {
        let url = format!(
            "{}/apps/{}/sessions/{}/tracks/new",
            self.config.api_base_url, self.config.app_id, viewer_session_id
        );
        let body = TrackRequest {
            tracks: vec![TrackObject {
                location: "remote",
                session_id: publisher_session_id,
                track_name,
                kind: "video",
            }],
        };
        let response = self
            .http
            .post(url)
            .bearer_auth(&self.config.app_secret)
            .json(&body)
            .send()
            .await
            .context("Cloudflare Realtime pull track request failed")?;
        let status = response.status();
        let body = response
            .json::<TracksResponse>()
            .await
            .context("Cloudflare Realtime pull track response was invalid")?;
        if !status.is_success() || body.error_code.is_some() {
            return Err(anyhow!(
                "Cloudflare Realtime pull track failed: {}",
                body.error_description
                    .clone()
                    .or(body.error_code.clone())
                    .unwrap_or_else(|| status.to_string())
            ));
        }
        Ok(body)
    }

    pub async fn renegotiate(
        &self,
        session_id: &str,
        session_description: SessionDescription,
    ) -> anyhow::Result<RenegotiateResponse> {
        let url = format!(
            "{}/apps/{}/sessions/{}/renegotiate",
            self.config.api_base_url, self.config.app_id, session_id
        );
        let response = self
            .http
            .put(url)
            .bearer_auth(&self.config.app_secret)
            .json(&RenegotiateRequest { session_description })
            .send()
            .await
            .context("Cloudflare Realtime renegotiate request failed")?;
        let status = response.status();
        let body = response
            .json::<RenegotiateResponse>()
            .await
            .context("Cloudflare Realtime renegotiate response was invalid")?;
        if !status.is_success() || body.error_code.is_some() {
            return Err(anyhow!(
                "Cloudflare Realtime renegotiate failed: {}",
                body.error_description
                    .clone()
                    .or(body.error_code.clone())
                    .unwrap_or_else(|| status.to_string())
            ));
        }
        Ok(body)
    }
}
