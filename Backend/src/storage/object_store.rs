use std::time::Duration;

use anyhow::Context;
use aws_sdk_s3::config::{BehaviorVersion, Credentials};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::{Client, Config};
use aws_types::region::Region;
use bytes::Bytes;

use crate::config::ObjectStoreConfig;

#[derive(Clone)]
pub struct R2Store {
    client: Client,
    bucket: String,
    signed_url_ttl: Duration,
    upload_timeout: Duration,
}

impl R2Store {
    pub async fn from_config(config: &ObjectStoreConfig) -> anyhow::Result<Self> {
        let credentials = Credentials::new(
            config.access_key_id.clone(),
            config.secret_access_key.clone(),
            None,
            None,
            "cloudflare-r2",
        );
        let endpoint = format!("https://{}.r2.cloudflarestorage.com", config.account_id);
        let sdk_config = Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .endpoint_url(endpoint)
            .credentials_provider(credentials)
            .region(Region::new("auto"))
            .build();

        Ok(Self {
            client: Client::from_conf(sdk_config),
            bucket: config.bucket.clone(),
            signed_url_ttl: config.signed_url_ttl,
            upload_timeout: config.upload_timeout,
        })
    }

    pub async fn put_jpeg(&self, key: &str, bytes: Bytes) -> anyhow::Result<()> {
        tokio::time::timeout(
            self.upload_timeout,
            self.client
                .put_object()
                .bucket(&self.bucket)
                .key(key)
                .content_type("image/jpeg")
                .body(ByteStream::from(bytes.to_vec()))
                .send(),
        )
        .await
        .context("R2 upload timed out")?
        .context("R2 upload failed")?;

        Ok(())
    }

    pub async fn signed_get_url(&self, key: &str) -> anyhow::Result<String> {
        let presigning = PresigningConfig::expires_in(self.signed_url_ttl)?;
        let request = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .presigned(presigning)
            .await
            .context("R2 presign failed")?;

        Ok(request.uri().to_string())
    }
}

pub async fn upload_with_retry(
    store: &R2Store,
    key: &str,
    bytes: Bytes,
    max_attempts: u32,
) -> anyhow::Result<()> {
    let mut attempt = 1;
    loop {
        match store.put_jpeg(key, bytes.clone()).await {
            Ok(()) => return Ok(()),
            Err(error) if attempt < max_attempts => {
                tracing::warn!(%key, %attempt, %error, "frame upload retry");
                let delay_ms = 100_u64 * (1_u64 << (attempt - 1));
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}
