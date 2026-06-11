use std::time::Duration;

use anyhow::Context;
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;
use bytes::Bytes;

use crate::config::ObjectStoreConfig;

#[derive(Clone)]
pub struct R2Store {
    client: Client,
    presign_client: Client,
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
            "diminspect-object-store",
        );
        let endpoint = config.endpoint.clone().unwrap_or_else(|| {
            format!(
                "https://{}.r2.cloudflarestorage.com",
                config.account_id.clone().unwrap_or_default()
            )
        });
        let sdk_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .credentials_provider(credentials)
            .region(Region::new(config.region.clone()))
            .load()
            .await;

        let client = Self::build_client(&sdk_config, &endpoint, config.force_path_style);
        let presign_client = match &config.public_endpoint {
            Some(public) if public != &endpoint => {
                Self::build_client(&sdk_config, public, config.force_path_style)
            }
            _ => client.clone(),
        };

        let store = Self {
            client,
            presign_client,
            bucket: config.bucket.clone(),
            signed_url_ttl: config.signed_url_ttl,
            upload_timeout: config.upload_timeout,
        };

        if config.force_path_style {
            store.ensure_bucket().await;
        }

        Ok(store)
    }

    fn build_client(
        sdk_config: &aws_config::SdkConfig,
        endpoint: &str,
        force_path_style: bool,
    ) -> Client {
        let s3_config = aws_sdk_s3::config::Builder::from(sdk_config)
            .endpoint_url(endpoint)
            .force_path_style(force_path_style)
            .build();
        Client::from_conf(s3_config)
    }

    async fn ensure_bucket(&self) {
        for _ in 0..10u32 {
            match self.bucket_exists().await {
                Ok(true) => return,
                Ok(false) => {
                    if self
                        .client
                        .create_bucket()
                        .bucket(&self.bucket)
                        .send()
                        .await
                        .is_ok()
                    {
                        return;
                    }
                }
                Err(_) => {}
            }
            tokio::time::sleep(Duration::from_millis(1000)).await;
        }
        tracing::warn!(bucket = %self.bucket, "object store bucket not ready after retries");
    }

    async fn bucket_exists(&self) -> anyhow::Result<bool> {
        match self.client.head_bucket().bucket(&self.bucket).send().await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    pub async fn put_jpeg(&self, key: &str, bytes: Bytes) -> anyhow::Result<()> {
        tokio::time::timeout(
            self.upload_timeout,
            self.client
                .put_object()
                .bucket(&self.bucket)
                .key(key)
                .content_type("image/jpeg")
                .body(ByteStream::from(bytes))
                .send(),
        )
        .await
        .context("object store upload timed out")?
        .context("object store upload failed")?;

        Ok(())
    }

    pub async fn delete_object(&self, key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .context("object store delete failed")?;

        Ok(())
    }

    pub async fn object_exists(&self, key: &str) -> anyhow::Result<bool> {
        match self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
        {
            Ok(_) => Ok(true),
            Err(error) => {
                let service_error = error.into_service_error();
                if service_error.is_not_found() {
                    Ok(false)
                } else {
                    Err(anyhow::Error::new(service_error).context("object store head failed"))
                }
            }
        }
    }

    pub async fn signed_get_url(&self, key: &str) -> anyhow::Result<String> {
        let presigning = PresigningConfig::expires_in(self.signed_url_ttl)?;
        let request = self
            .presign_client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .presigned(presigning)
            .await
            .context("object store presign failed")?;

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
