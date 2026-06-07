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

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    pub(crate) struct InMemoryAvatarStore {
        objects: Mutex<HashMap<String, Bytes>>,
    }

    impl InMemoryAvatarStore {
        pub(crate) fn new() -> Self {
            Self::default()
        }

        pub(crate) fn keys(&self) -> Vec<String> {
            self.objects.lock().unwrap().keys().cloned().collect()
        }

        pub(crate) fn get(&self, key: &str) -> Option<Bytes> {
            self.objects.lock().unwrap().get(key).cloned()
        }
    }

    #[async_trait]
    impl AvatarObjectStore for InMemoryAvatarStore {
        async fn put_jpeg(&self, key: &str, bytes: Bytes) -> anyhow::Result<()> {
            self.objects.lock().unwrap().insert(key.to_string(), bytes);
            Ok(())
        }

        async fn object_exists(&self, key: &str) -> anyhow::Result<bool> {
            Ok(self.objects.lock().unwrap().contains_key(key))
        }

        async fn delete_object(&self, key: &str) -> anyhow::Result<()> {
            self.objects.lock().unwrap().remove(key);
            Ok(())
        }

        async fn signed_get_url(&self, key: &str) -> anyhow::Result<String> {
            Ok(format!("https://fake.r2.local/{key}?signature=test"))
        }
    }

    fn normalized(content_type: &str) -> String {
        content_type
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
    }

    fn any_content_type() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("image/jpeg".to_string()),
            Just("image/png".to_string()),
            Just("image/webp".to_string()),
            Just("image/gif".to_string()),
            Just("text/plain".to_string()),
            Just("application/octet-stream".to_string()),
            Just(String::new()),
            "[a-zA-Z0-9/;+. -]{0,40}".prop_map(|s| s),
        ]
    }

    fn invalid_content_type() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("text/plain".to_string()),
            Just("application/json".to_string()),
            Just("application/octet-stream".to_string()),
            Just("image/svg+xml".to_string()),
            Just("image/bmp".to_string()),
            Just("image/tiff".to_string()),
            Just("video/mp4".to_string()),
            Just(String::new()),
            "[a-zA-Z0-9/;+. -]{0,40}".prop_map(|s| s),
        ]
        .prop_filter("must not be an accepted content type", |content_type| {
            !ACCEPTED_CONTENT_TYPES.contains(&normalized(content_type).as_str())
        })
    }

    fn invalid_upload() -> impl Strategy<Value = (String, usize, AvatarError)> {
        prop_oneof![
            any_content_type().prop_map(|ct| (ct, 0usize, AvatarError::EmptyFile)),
            (
                (MAX_AVATAR_BYTES + 1)..=(MAX_AVATAR_BYTES + 10 * 1024 * 1024),
                any_content_type()
            )
                .prop_map(|(len, ct)| (ct, len, AvatarError::TooLarge)),
            (1usize..=MAX_AVATAR_BYTES, invalid_content_type())
                .prop_map(|(len, ct)| (ct, len, AvatarError::UnsupportedType)),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 3: Invalid uploads are rejected without storing anything
        #[test]
        fn prop_invalid_uploads_are_rejected((content_type, len, expected) in invalid_upload()) {
            let result = validate_upload(&content_type, len);
            prop_assert_eq!(result, Err(expected));
        }
    }

    fn spec_valid_segment(segment: &str) -> bool {
        !segment.is_empty()
            && segment.len() <= MAX_SEGMENT_LEN
            && segment
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    }

    fn spec_canonical_uuid(value: &str) -> bool {
        let group_lengths = [8usize, 4, 4, 4, 12];
        let groups: Vec<&str> = value.split('-').collect();
        if groups.len() != group_lengths.len() {
            return false;
        }
        groups
            .iter()
            .zip(group_lengths.iter())
            .all(|(group, &expected_len)| {
                group.len() == expected_len
                    && group.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            })
    }

    fn spec_valid_object_key(value: &str) -> bool {
        let segments: Vec<&str> = value.split('/').collect();
        if !segments.iter().all(|segment| spec_valid_segment(segment)) {
            return false;
        }
        if segments.len() != 2 || segments[0] != "avatars" {
            return false;
        }
        match segments[1].strip_suffix(".jpg") {
            Some(stem) => spec_canonical_uuid(stem),
            None => false,
        }
    }

    fn valid_key_strategy() -> impl Strategy<Value = String> {
        any::<[u8; 16]>()
            .prop_map(|bytes| format!("{}{}.jpg", AVATAR_KEY_PREFIX, Uuid::from_bytes(bytes).hyphenated()))
    }

    fn candidate_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            valid_key_strategy(),
            any::<String>(),
            "[a-zA-Z0-9_./-]{0,80}",
            "avatars/[a-zA-Z0-9._-]{0,40}\\.jpg",
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                .prop_map(|uuid| format!("avatars/{}.jpg", uuid)),
            (valid_key_strategy(), any::<String>()).prop_map(|(key, suffix)| format!("{}{}", key, suffix)),
            ("[a-zA-Z0-9._/-]{0,20}", valid_key_strategy())
                .prop_map(|(prefix, key)| format!("{}{}", prefix, key)),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 1: Object key generation/validation round trip
        #[test]
        fn prop_object_key_generation_validation_round_trip(
            generation_count in 1usize..50,
            candidate in candidate_strategy(),
        ) {
            for _ in 0..generation_count {
                let key = generate_object_key();
                let stem = key
                    .strip_prefix(AVATAR_KEY_PREFIX)
                    .and_then(|name| name.strip_suffix(".jpg"));
                prop_assert!(stem.is_some(), "generated key not of form avatars/<uuid>.jpg: {key}");
                let stem = stem.unwrap();
                prop_assert!(spec_canonical_uuid(stem), "uuid stem not lowercase canonical: {stem}");
                prop_assert_eq!(stem.len(), 36);
                prop_assert_eq!(key.len(), AVATAR_KEY_PREFIX.len() + 36 + ".jpg".len());
                prop_assert!(is_valid_object_key(&key), "generated key rejected by validator: {key}");
            }

            prop_assert_eq!(
                is_valid_object_key(&candidate),
                spec_valid_object_key(&candidate),
                "validator disagreed with spec oracle for candidate: {:?}",
                candidate
            );
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 2: Valid uploads are stored and the storing key is returned
        #[test]
        fn prop_valid_uploads_are_stored_and_key_returned(
            payload in prop::collection::vec(any::<u8>(), 1..4096)
        ) {
            let bytes = Bytes::from(payload);
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap();
            let store = InMemoryAvatarStore::new();
            let returned_key = runtime.block_on(store_avatar_with_backoff(
                &store,
                bytes.clone(),
                Duration::from_millis(1),
            ));
            let returned_key = returned_key.expect("valid upload should succeed");

            prop_assert!(is_valid_object_key(&returned_key));

            let keys = store.keys();
            prop_assert_eq!(keys.len(), 1, "store should contain exactly one object");
            prop_assert_eq!(&keys[0], &returned_key, "stored key must equal returned key");

            let stored_bytes = store.get(&returned_key);
            prop_assert_eq!(stored_bytes, Some(bytes), "stored bytes must match uploaded bytes");
        }
    }

    struct BackoffFakeStore {
        fail_first: usize,
        put_attempts: std::sync::atomic::AtomicUsize,
    }

    impl BackoffFakeStore {
        fn new(fail_first: usize) -> Self {
            Self {
                fail_first,
                put_attempts: std::sync::atomic::AtomicUsize::new(0),
            }
        }

        fn attempts(&self) -> usize {
            self.put_attempts.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl AvatarObjectStore for BackoffFakeStore {
        async fn put_jpeg(&self, _key: &str, _bytes: Bytes) -> anyhow::Result<()> {
            let prior = self
                .put_attempts
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if prior < self.fail_first {
                Err(anyhow::anyhow!("transient upload failure"))
            } else {
                Ok(())
            }
        }

        async fn object_exists(&self, _key: &str) -> anyhow::Result<bool> {
            Ok(false)
        }

        async fn delete_object(&self, _key: &str) -> anyhow::Result<()> {
            Ok(())
        }

        async fn signed_get_url(&self, _key: &str) -> anyhow::Result<String> {
            Ok(String::new())
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 4: Upload retries use bounded exponential backoff
        #[test]
        fn prop_upload_retries_bounded_exponential_backoff(k in 0usize..=5) {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap();
            let store = BackoffFakeStore::new(k);
            let result = runtime.block_on(store_avatar_with_backoff(
                &store,
                Bytes::from_static(b"avatar-bytes"),
                Duration::from_millis(0),
            ));

            let expected_success = k < MAX_UPLOAD_ATTEMPTS as usize;
            prop_assert_eq!(result.is_ok(), expected_success);
            if !expected_success {
                prop_assert_eq!(result.err(), Some(AvatarError::StorageUnavailable));
            }

            let expected_attempts = std::cmp::min(k + 1, MAX_UPLOAD_ATTEMPTS as usize);
            prop_assert_eq!(store.attempts(), expected_attempts);
        }
    }

    struct CollisionScheduleStore {
        collisions: usize,
        queried_keys: std::sync::Mutex<Vec<String>>,
        stored_key: std::sync::Mutex<Option<String>>,
        put_calls: std::sync::Mutex<usize>,
    }

    impl CollisionScheduleStore {
        fn new(collisions: usize) -> Self {
            Self {
                collisions,
                queried_keys: std::sync::Mutex::new(Vec::new()),
                stored_key: std::sync::Mutex::new(None),
                put_calls: std::sync::Mutex::new(0),
            }
        }
    }

    #[async_trait]
    impl AvatarObjectStore for CollisionScheduleStore {
        async fn put_jpeg(&self, key: &str, _bytes: Bytes) -> anyhow::Result<()> {
            *self.put_calls.lock().unwrap() += 1;
            *self.stored_key.lock().unwrap() = Some(key.to_string());
            Ok(())
        }

        async fn object_exists(&self, key: &str) -> anyhow::Result<bool> {
            let mut keys = self.queried_keys.lock().unwrap();
            keys.push(key.to_string());
            Ok(keys.len() <= self.collisions)
        }

        async fn delete_object(&self, _key: &str) -> anyhow::Result<()> {
            Ok(())
        }

        async fn signed_get_url(&self, key: &str) -> anyhow::Result<String> {
            Ok(format!("signed://{key}"))
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 5: Object key collisions trigger bounded regeneration
        #[test]
        fn prop_object_key_collisions_trigger_bounded_regeneration(collisions in 0usize..=6) {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap();
            runtime.block_on(async {
                let store = CollisionScheduleStore::new(collisions);
                let result = store_avatar_with_backoff(
                    &store,
                    Bytes::from_static(b"jpeg-bytes"),
                    Duration::from_millis(1),
                )
                .await;

                let queried = store.queried_keys.lock().unwrap().clone();
                let stored = store.stored_key.lock().unwrap().clone();
                let put_calls = *store.put_calls.lock().unwrap();

                if collisions <= 3 {
                    let key = result
                        .expect("store_avatar should succeed when a free key appears within attempts");
                    prop_assert_eq!(queried.len(), collisions + 1);
                    prop_assert_eq!(&key, &queried[collisions]);
                    prop_assert_eq!(stored.as_deref(), Some(key.as_str()));
                    prop_assert_eq!(put_calls, 1);
                } else {
                    prop_assert_eq!(result, Err(AvatarError::KeyCollision));
                    prop_assert_eq!(queried.len(), MAX_KEY_ATTEMPTS as usize);
                    prop_assert_eq!(stored, None);
                    prop_assert_eq!(put_calls, 0);
                }
                Ok(())
            })?;
        }
    }

    struct FailingDeleteStore {
        fail: bool,
    }

    #[async_trait]
    impl AvatarObjectStore for FailingDeleteStore {
        async fn put_jpeg(&self, _key: &str, _bytes: Bytes) -> anyhow::Result<()> {
            Ok(())
        }

        async fn object_exists(&self, _key: &str) -> anyhow::Result<bool> {
            Ok(false)
        }

        async fn delete_object(&self, _key: &str) -> anyhow::Result<()> {
            if self.fail {
                Err(anyhow::anyhow!("transient delete failure"))
            } else {
                Ok(())
            }
        }

        async fn signed_get_url(&self, key: &str) -> anyhow::Result<String> {
            Ok(format!("signed://{key}"))
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 15: Deletion failures never fail the user update
        #[test]
        fn prop_deletion_failures_never_fail_the_update(
            fail in any::<bool>(),
            key in candidate_strategy(),
        ) {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap();
            let store = FailingDeleteStore { fail };
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                runtime.block_on(delete_avatar(&store, &key));
            }));
            prop_assert!(
                outcome.is_ok(),
                "delete_avatar must complete without panicking regardless of delete outcome (fail={})",
                fail
            );
        }
    }

    struct PresignFakeStore;

    #[async_trait]
    impl AvatarObjectStore for PresignFakeStore {
        async fn put_jpeg(&self, _key: &str, _bytes: Bytes) -> anyhow::Result<()> {
            Ok(())
        }

        async fn object_exists(&self, _key: &str) -> anyhow::Result<bool> {
            Ok(false)
        }

        async fn delete_object(&self, _key: &str) -> anyhow::Result<()> {
            Ok(())
        }

        async fn signed_get_url(&self, key: &str) -> anyhow::Result<String> {
            Ok(format!(
                "https://bucket.r2.cloudflarestorage.com/{key}?\
X-Amz-Algorithm=AWS4-HMAC-SHA256\
&X-Amz-Credential=AKIDEXAMPLE%2F20240101%2Fauto%2Fs3%2Faws4_request\
&X-Amz-Date=20240101T000000Z\
&X-Amz-Expires=3600\
&X-Amz-SignedHeaders=host\
&X-Amz-Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
            ))
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 10: Served avatars are always presigned URLs for the stored key
        #[test]
        fn prop_served_avatars_are_presigned_urls_for_stored_key(key in valid_key_strategy()) {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap();
            let store = PresignFakeStore;
            let signed = runtime.block_on(sign_avatar(&store, &key));
            let url = signed
                .expect("signing should succeed for a valid key when storage is available");

            let (resource, query) = url
                .split_once('?')
                .expect("presigned url must carry query parameters");

            prop_assert!(
                resource.ends_with(&key),
                "presigned url must be derived from the stored key: {url}"
            );
            prop_assert!(
                query.contains("Signature"),
                "presigned url must carry a signature query parameter: {url}"
            );
            prop_assert!(
                query.contains("Expires"),
                "presigned url must carry an expiry query parameter: {url}"
            );
            prop_assert!(
                !query.is_empty(),
                "served avatar must never be a bare object url without signing: {url}"
            );
        }
    }

    async fn serve_avatar_urls<S>(avatars: &mut [Option<String>], store: Option<&S>)
    where
        S: AvatarObjectStore + ?Sized,
    {
        let Some(store) = store else {
            for avatar in avatars.iter_mut() {
                *avatar = None;
            }
            return;
        };
        for avatar in avatars.iter_mut() {
            if let Some(key) = avatar.clone() {
                *avatar = sign_avatar(store, &key).await;
            }
        }
    }

    struct SigningScheduleStore {
        fail_keys: std::collections::HashSet<String>,
    }

    #[async_trait]
    impl AvatarObjectStore for SigningScheduleStore {
        async fn put_jpeg(&self, _key: &str, _bytes: Bytes) -> anyhow::Result<()> {
            Ok(())
        }

        async fn object_exists(&self, _key: &str) -> anyhow::Result<bool> {
            Ok(false)
        }

        async fn delete_object(&self, _key: &str) -> anyhow::Result<()> {
            Ok(())
        }

        async fn signed_get_url(&self, key: &str) -> anyhow::Result<String> {
            if self.fail_keys.contains(key) {
                Err(anyhow::anyhow!("signing failed for {key}"))
            } else {
                Ok(format!("https://signed.local/{key}?signature=test"))
            }
        }
    }

    fn serving_specs_strategy() -> impl Strategy<Value = Vec<(Option<String>, bool)>> {
        prop::collection::vec((proptest::option::of("[a-z0-9/_.-]{1,30}"), any::<bool>()), 0..20)
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 11: Avatar serving degrades gracefully
        #[test]
        fn prop_avatar_serving_degrades_gracefully(specs in serving_specs_strategy()) {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap();
            runtime.block_on(async {
                let original: Vec<Option<String>> =
                    specs.iter().map(|(key, _)| key.clone()).collect();
                let fail_keys: std::collections::HashSet<String> = specs
                    .iter()
                    .filter_map(|(key, fail)| key.clone().filter(|_| *fail))
                    .collect();

                let mut unconfigured = original.clone();
                serve_avatar_urls::<SigningScheduleStore>(&mut unconfigured, None).await;
                prop_assert_eq!(unconfigured.len(), original.len());
                prop_assert!(
                    unconfigured.iter().all(|avatar| avatar.is_none()),
                    "unconfigured store must yield only null avatars"
                );

                let store = SigningScheduleStore {
                    fail_keys: fail_keys.clone(),
                };
                let mut served = original.clone();
                serve_avatar_urls(&mut served, Some(&store)).await;

                prop_assert_eq!(served.len(), original.len(), "every user must be returned");
                for (orig, out) in original.iter().zip(served.iter()) {
                    match orig {
                        None => prop_assert!(out.is_none(), "no-key user must stay null"),
                        Some(key) if fail_keys.contains(key) => prop_assert!(
                            out.is_none(),
                            "user with failed signing must have null avatar: {key}"
                        ),
                        Some(key) => {
                            let expected = format!("https://signed.local/{key}?signature=test");
                            prop_assert_eq!(
                                out.as_deref(),
                                Some(expected.as_str()),
                                "successful signing must yield the signed url for {}",
                                key
                            );
                        }
                    }
                }
                Ok(())
            })?;
        }
    }
}
