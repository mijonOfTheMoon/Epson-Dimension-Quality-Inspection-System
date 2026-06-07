use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use uuid::Uuid;

use crate::error::AppError;
use crate::storage::object_store::R2Store;

pub const AVATAR_KEY_PREFIX: &str = "avatars/";
pub const MAX_AVATAR_BYTES: usize = 5 * 1024 * 1024;
pub const ACCEPTED_CONTENT_TYPES: &[&str] =
    &["image/jpeg", "image/png", "image/webp", "image/gif"];

const MAX_SEGMENT_LEN: usize = 255;
const MAX_UPLOAD_ATTEMPTS: u32 = 3;
const MAX_KEY_ATTEMPTS: u32 = 4;
const UPLOAD_BACKOFF_BASE: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AvatarError {
    NotConfigured,
    StorageUnavailable,
    EmptyFile,
    UnsupportedType,
    TooLarge,
    InvalidObjectKey,
    DataUrlNotAllowed,
    KeyCollision,
}

impl From<AvatarError> for AppError {
    fn from(value: AvatarError) -> Self {
        match value {
            AvatarError::NotConfigured => {
                AppError::ServiceUnavailable("Penyimpanan avatar belum dikonfigurasi".into())
            }
            AvatarError::StorageUnavailable => {
                AppError::ServiceUnavailable("Penyimpanan avatar tidak tersedia".into())
            }
            AvatarError::EmptyFile => AppError::BadRequest("Berkas gambar kosong.".into()),
            AvatarError::UnsupportedType => AppError::BadRequest("File harus berupa gambar.".into()),
            AvatarError::TooLarge => AppError::BadRequest("Ukuran gambar maksimal 5 MB.".into()),
            AvatarError::InvalidObjectKey => {
                AppError::BadRequest("Referensi avatar tidak valid.".into())
            }
            AvatarError::DataUrlNotAllowed => {
                AppError::BadRequest("Avatar harus diunggah sebagai berkas, bukan data URL.".into())
            }
            AvatarError::KeyCollision => {
                AppError::Internal(anyhow::anyhow!("gagal menghasilkan kunci avatar unik"))
            }
        }
    }
}

pub fn generate_object_key() -> String {
    format!("{}{}.jpg", AVATAR_KEY_PREFIX, Uuid::new_v4())
}

pub fn is_valid_object_key(value: &str) -> bool {
    let Some(file_name) = value.strip_prefix(AVATAR_KEY_PREFIX) else {
        return false;
    };
    if !value.split('/').all(is_valid_segment) {
        return false;
    }
    let Some(stem) = file_name.strip_suffix(".jpg") else {
        return false;
    };
    Uuid::try_parse(stem)
        .map(|parsed| parsed.hyphenated().to_string() == stem)
        .unwrap_or(false)
}

pub fn is_data_url(value: &str) -> bool {
    value.trim_start().to_ascii_lowercase().starts_with("data:")
}

pub fn validate_upload(content_type: &str, len: usize) -> Result<(), AvatarError> {
    if len == 0 {
        return Err(AvatarError::EmptyFile);
    }
    if len > MAX_AVATAR_BYTES {
        return Err(AvatarError::TooLarge);
    }
    let normalized = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !ACCEPTED_CONTENT_TYPES.contains(&normalized.as_str()) {
        return Err(AvatarError::UnsupportedType);
    }
    Ok(())
}

fn is_valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= MAX_SEGMENT_LEN
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

#[async_trait]
pub trait AvatarObjectStore {
    async fn put_jpeg(&self, key: &str, bytes: Bytes) -> anyhow::Result<()>;
    async fn object_exists(&self, key: &str) -> anyhow::Result<bool>;
    async fn delete_object(&self, key: &str) -> anyhow::Result<()>;
    async fn signed_get_url(&self, key: &str) -> anyhow::Result<String>;
}

#[async_trait]
impl AvatarObjectStore for R2Store {
    async fn put_jpeg(&self, key: &str, bytes: Bytes) -> anyhow::Result<()> {
        R2Store::put_jpeg(self, key, bytes).await
    }

    async fn object_exists(&self, key: &str) -> anyhow::Result<bool> {
        R2Store::object_exists(self, key).await
    }

    async fn delete_object(&self, key: &str) -> anyhow::Result<()> {
        R2Store::delete_object(self, key).await
    }

    async fn signed_get_url(&self, key: &str) -> anyhow::Result<String> {
        R2Store::signed_get_url(self, key).await
    }
}

pub async fn store_avatar<S>(store: &S, bytes: Bytes) -> Result<String, AvatarError>
where
    S: AvatarObjectStore + ?Sized,
{
    store_avatar_with_backoff(store, bytes, UPLOAD_BACKOFF_BASE).await
}

pub(crate) async fn store_avatar_with_backoff<S>(
    store: &S,
    bytes: Bytes,
    backoff_base: Duration,
) -> Result<String, AvatarError>
where
    S: AvatarObjectStore + ?Sized,
{
    let key = allocate_unique_key(store).await?;
    upload_with_backoff(store, &key, bytes, MAX_UPLOAD_ATTEMPTS, backoff_base).await?;
    Ok(key)
}

pub async fn sign_avatar<S>(store: &S, key: &str) -> Option<String>
where
    S: AvatarObjectStore + ?Sized,
{
    match store.signed_get_url(key).await {
        Ok(url) => Some(url),
        Err(error) => {
            tracing::warn!(%key, %error, "avatar signing failed");
            None
        }
    }
}

pub async fn delete_avatar<S>(store: &S, key: &str)
where
    S: AvatarObjectStore + ?Sized,
{
    if let Err(error) = store.delete_object(key).await {
        tracing::warn!(%key, %error, "avatar deletion failed");
    }
}

async fn allocate_unique_key<S>(store: &S) -> Result<String, AvatarError>
where
    S: AvatarObjectStore + ?Sized,
{
    for _ in 0..MAX_KEY_ATTEMPTS {
        let key = generate_object_key();
        match store.object_exists(&key).await {
            Ok(false) => return Ok(key),
            Ok(true) => continue,
            Err(error) => {
                tracing::warn!(%key, %error, "avatar key existence check failed");
                return Err(AvatarError::StorageUnavailable);
            }
        }
    }
    Err(AvatarError::KeyCollision)
}

async fn upload_with_backoff<S>(
    store: &S,
    key: &str,
    bytes: Bytes,
    max_attempts: u32,
    backoff_base: Duration,
) -> Result<(), AvatarError>
where
    S: AvatarObjectStore + ?Sized,
{
    let mut attempt = 1;
    loop {
        match store.put_jpeg(key, bytes.clone()).await {
            Ok(()) => return Ok(()),
            Err(error) if attempt < max_attempts => {
                tracing::warn!(%key, %attempt, %error, "avatar upload retry");
                let delay = backoff_base * (1 << (attempt - 1));
                tokio::time::sleep(delay).await;
                attempt += 1;
            }
            Err(error) => {
                tracing::warn!(%key, %error, "avatar upload failed");
                return Err(AvatarError::StorageUnavailable);
            }
        }
    }
}
