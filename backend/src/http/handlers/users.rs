use axum::extract::{Extension, Multipart, Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::avatar;
use crate::domain::{SafeUser, UserRole};
use crate::error::{AppError, AppResult};
use crate::http::router::CurrentUser;
use crate::http::AppState;
use crate::storage::{DataStore, UserInput, UserUpdateInput};

use super::{bad_request, require_auth, require_role, USER_MANAGER_ROLES};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarUploadResponse {
    pub object_key: String,
}

pub(crate) async fn attach_avatar_urls(
    users: &mut [SafeUser],
    store: Option<std::sync::Arc<crate::storage::object_store::R2Store>>,
) {
    let Some(store) = store else {
        for user in users.iter_mut() {
            user.avatar = None;
        }
        return;
    };

    for user in users.iter_mut() {
        if let Some(key) = user.avatar.clone() {
            let signed = avatar::sign_avatar(store.as_ref(), &key).await;
            if signed.is_none() {
                tracing::warn!(user_id = %user.id, %key, "avatar signing failed");
            }
            user.avatar = signed;
        }
    }
}

fn previous_avatar_to_delete<'a>(previous: Option<&'a str>, new: Option<&str>) -> Option<&'a str> {
    match previous {
        Some(prev) if new != Some(prev) => Some(prev),
        _ => None,
    }
}

fn can_persist_avatar(is_manager: bool, is_self: bool) -> bool {
    is_manager || is_self
}

fn normalize_avatar(value: Option<String>) -> Result<Option<String>, avatar::AvatarError> {
    match value {
        Some(raw) if !raw.trim().is_empty() => {
            if avatar::is_data_url(&raw) {
                Err(avatar::AvatarError::DataUrlNotAllowed)
            } else if !avatar::is_valid_object_key(&raw) {
                Err(avatar::AvatarError::InvalidObjectKey)
            } else {
                Ok(Some(raw))
            }
        }
        _ => Ok(None),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCreateBody {
    username: String,
    password: String,
    name: String,
    role: UserRole,
    avatar: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserUpdateBody {
    username: String,
    password: Option<String>,
    name: String,
    role: UserRole,
    avatar: Option<String>,
}

pub async fn upload_avatar(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    mut multipart: Multipart,
) -> AppResult<Json<AvatarUploadResponse>> {
    require_auth(&current)?;
    let store = state
        .object_store
        .as_ref()
        .ok_or(avatar::AvatarError::NotConfigured)?;

    let mut upload = None;
    while let Some(field) = multipart.next_field().await.map_err(bad_request)? {
        if field.name() == Some("file") {
            let content_type = field.content_type().map(str::to_string).unwrap_or_default();
            let bytes = field.bytes().await.map_err(bad_request)?;
            upload = Some((content_type, bytes));
            break;
        }
    }

    let (content_type, bytes) =
        upload.ok_or_else(|| AppError::BadRequest("Berkas avatar tidak ditemukan.".into()))?;

    avatar::validate_upload(&content_type, bytes.len())?;
    let object_key = avatar::store_avatar(store.as_ref(), bytes).await?;
    Ok(Json(AvatarUploadResponse { object_key }))
}

pub async fn list(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
) -> AppResult<Json<Vec<SafeUser>>> {
    require_role(&current, USER_MANAGER_ROLES)?;
    let mut users = state.store.list_users().await?;
    attach_avatar_urls(&mut users, state.object_store.clone()).await;
    Ok(Json(users))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Json(body): Json<UserCreateBody>,
) -> AppResult<(StatusCode, Json<SafeUser>)> {
    require_role(&current, USER_MANAGER_ROLES)?;
    if body.username.trim().is_empty() || body.password.len() < 4 || body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Invalid request".into()));
    }
    let avatar = normalize_avatar(body.avatar)?;
    let user = state
        .store
        .create_user(UserInput {
            username: body.username,
            password: body.password,
            name: body.name,
            role: body.role,
            avatar,
        })
        .await
        .map_err(bad_request)?;
    let mut users = [user];
    attach_avatar_urls(&mut users, state.object_store.clone()).await;
    let [user] = users;
    Ok((StatusCode::CREATED, Json(user)))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(body): Json<UserUpdateBody>,
) -> AppResult<Json<SafeUser>> {
    let auth_user = require_auth(&current)?;
    let is_manager = USER_MANAGER_ROLES.contains(&auth_user.role);
    let is_self = auth_user.id == id;
    if !can_persist_avatar(is_manager, is_self) {
        return Err(AppError::Forbidden);
    }

    let avatar = normalize_avatar(body.avatar)?;
    let new_key = avatar.clone();

    let existing = state
        .store
        .find_user_by_id(&id)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    let update_input = if is_manager {
        if body.username.trim().is_empty() || body.name.trim().is_empty() {
            return Err(AppError::BadRequest("Invalid request".into()));
        }
        if let Some(password) = body.password.as_ref() {
            if !password.is_empty() && password.len() < 4 {
                return Err(AppError::BadRequest("Invalid request".into()));
            }
        }
        if auth_user.id == id && body.role != UserRole::Admin {
            return Err(AppError::BadRequest(
                "Tidak boleh mencabut role admin dari diri sendiri".into(),
            ));
        }
        if existing.role == UserRole::Admin
            && body.role != UserRole::Admin
            && state.store.count_users_by_role(UserRole::Admin).await? <= 1
        {
            return Err(AppError::BadRequest(
                "Admin terakhir tidak boleh diubah rolenya".into(),
            ));
        }
        UserUpdateInput {
            username: body.username,
            password: body.password.filter(|password| !password.is_empty()),
            name: body.name,
            role: body.role,
            avatar,
        }
    } else {
        UserUpdateInput {
            username: existing.username.clone(),
            password: None,
            name: existing.name.clone(),
            role: existing.role,
            avatar,
        }
    };

    let previous_key = existing.avatar.clone();

    let user = state
        .store
        .update_user(&id, update_input)
        .await
        .map_err(bad_request)?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;

    if let Some(previous) = previous_avatar_to_delete(previous_key.as_deref(), new_key.as_deref()) {
        if let Some(store) = state.object_store.as_ref() {
            avatar::delete_avatar(store.as_ref(), previous).await;
        }
    }

    let mut users = [user];
    attach_avatar_urls(&mut users, state.object_store.clone()).await;
    let [user] = users;
    Ok(Json(user))
}

pub async fn delete_user(
    State(state): State<AppState>,
    Extension(current): Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let auth_user = require_role(&current, USER_MANAGER_ROLES)?;
    if auth_user.id == id {
        return Err(AppError::BadRequest(
            "Tidak boleh menghapus user sendiri".into(),
        ));
    }
    let existing = state
        .store
        .find_user_by_id(&id)
        .await?
        .ok_or_else(|| AppError::NotFound("User tidak ditemukan".into()))?;
    if existing.role == UserRole::Admin
        && state.store.count_users_by_role(UserRole::Admin).await? <= 1
    {
        return Err(AppError::BadRequest(
            "Admin terakhir tidak boleh dihapus".into(),
        ));
    }
    let deleted = state.store.delete_user(&id).await?;
    if !deleted {
        return Err(AppError::NotFound("User tidak ditemukan".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use uuid::Uuid;

    fn valid_object_key_strategy() -> impl Strategy<Value = String> {
        any::<[u8; 16]>().prop_map(|bytes| {
            format!("avatars/{}.jpg", Uuid::from_bytes(bytes).hyphenated())
        })
    }

    fn role_strategy() -> impl Strategy<Value = UserRole> {
        prop_oneof![
            Just(UserRole::Operator),
            Just(UserRole::Qc),
            Just(UserRole::Supervisor),
            Just(UserRole::Engineering),
            Just(UserRole::Admin),
            Just(UserRole::Vendor),
        ]
    }

    fn lifecycle_pair_strategy() -> impl Strategy<Value = (Option<String>, Option<String>)> {
        (
            proptest::option::of(valid_object_key_strategy()),
            0u8..3,
            valid_object_key_strategy(),
        )
            .prop_map(|(previous, choice, other)| {
                let new = match (previous.clone(), choice) {
                    (Some(prev), 0) => Some(prev),
                    (_, 1) => None,
                    _ => Some(other),
                };
                (previous, new)
            })
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 8: Valid object keys are persisted verbatim
        #[test]
        fn prop_valid_object_keys_persisted_verbatim(key in valid_object_key_strategy()) {
            let normalized = normalize_avatar(Some(key.clone()));
            prop_assert_eq!(normalized, Ok(Some(key)));
        }

        // Feature: avatar-r2-migration, Property 17: Authorization to persist an avatar
        #[test]
        fn prop_authorization_to_persist_avatar(is_manager in any::<bool>(), is_self in any::<bool>()) {
            prop_assert_eq!(can_persist_avatar(is_manager, is_self), is_manager || is_self);
            prop_assert_eq!(!can_persist_avatar(is_manager, is_self), !is_manager && !is_self);
        }

        // Feature: avatar-r2-migration, Property 17: Authorization to persist an avatar
        #[test]
        fn prop_authorization_over_user_roles(role in role_strategy(), is_self in any::<bool>()) {
            let is_manager = USER_MANAGER_ROLES.contains(&role);
            prop_assert_eq!(can_persist_avatar(is_manager, is_self), is_manager || is_self);
            if !is_manager && !is_self {
                prop_assert!(!can_persist_avatar(is_manager, is_self));
            }
        }

        // Feature: avatar-r2-migration, Property 14: Avatar object lifecycle on change
        #[test]
        fn prop_avatar_object_lifecycle_on_change(
            (previous, new) in lifecycle_pair_strategy()
        ) {
            let result = previous_avatar_to_delete(previous.as_deref(), new.as_deref());
            match (previous.as_deref(), new.as_deref()) {
                (None, _) => prop_assert_eq!(result, None),
                (Some(prev), None) => prop_assert_eq!(result, Some(prev)),
                (Some(prev), Some(n)) if n == prev => prop_assert_eq!(result, None),
                (Some(prev), Some(_)) => prop_assert_eq!(result, Some(prev)),
            }
        }
    }

    fn data_url_avatar_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB".to_string()),
            Just("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD=".to_string()),
            "data:[a-zA-Z0-9/;+=,_. -]{0,60}".prop_map(|s| s),
            "[ \t]{0,3}data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]{0,40}"
                .prop_map(|s| s),
        ]
        .prop_filter("data url must survive the trim/empty guard", |value| {
            !value.trim().is_empty() && avatar::is_data_url(value)
        })
    }

    fn invalid_object_key_avatar_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
                .prop_map(|uuid| format!("avatars/{uuid}.png")),
            "[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}"
                .prop_map(|uuid| format!("avatars/{uuid}.jpg")),
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
                .prop_map(|uuid| format!("avatars/nested/{uuid}.jpg")),
            "[a-z]{3,8}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg"
                .prop_map(|s| s),
            "avatars/[a-z0-9]{1,20}\\.jpg".prop_map(|s| s),
            "[a-zA-Z0-9 _./-]{1,40}".prop_map(|s| s),
            any::<String>(),
        ]
        .prop_filter(
            "must be a rejectable non-empty value that is neither a data url nor a valid key",
            |value| {
                !value.trim().is_empty()
                    && !avatar::is_data_url(value)
                    && !avatar::is_valid_object_key(value)
            },
        )
    }

    fn invalid_avatar_value_strategy() -> impl Strategy<Value = (String, avatar::AvatarError)> {
        prop_oneof![
            data_url_avatar_strategy()
                .prop_map(|value| (value, avatar::AvatarError::DataUrlNotAllowed)),
            invalid_object_key_avatar_strategy()
                .prop_map(|value| (value, avatar::AvatarError::InvalidObjectKey)),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: avatar-r2-migration, Property 9: Invalid avatar values are rejected and leave existing data unchanged
        #[test]
        fn prop_invalid_avatar_values_rejected_leave_data_unchanged(
            (value, expected) in invalid_avatar_value_strategy()
        ) {
            let result = normalize_avatar(Some(value));
            prop_assert_eq!(result, Err(expected));

            let app_error: AppError = expected.into();
            prop_assert!(
                matches!(app_error, AppError::BadRequest(_)),
                "invalid avatar value should map to a 400 BadRequest"
            );
        }
    }
}
