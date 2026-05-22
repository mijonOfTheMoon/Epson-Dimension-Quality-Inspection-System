use std::sync::Arc;

use bcrypt::verify;

use crate::auth::jwt;
use crate::config::Config;
use crate::domain::SafeUser;
use crate::storage::postgres::PostgresStore;
use crate::storage::DataStore;

#[derive(Clone)]
pub struct AuthService {
    config: Config,
    store: Arc<PostgresStore>,
}

impl AuthService {
    pub fn new(config: Config, store: Arc<PostgresStore>) -> Self {
        Self { config, store }
    }

    pub fn sign_token(&self, user: &SafeUser) -> anyhow::Result<String> {
        jwt::sign(user, &self.config.jwt_secret, &self.config.jwt_expires_in)
    }

    pub fn verify_token(&self, token: &str) -> Option<jwt::AuthTokenPayload> {
        jwt::verify(token, &self.config.jwt_secret)
    }

    pub async fn login(&self, username: &str, password: &str) -> anyhow::Result<Option<LoginResult>> {
        let Some(user) = self.store.find_user_by_username(username).await? else {
            return Ok(None);
        };
        if !verify(password, &user.password)? {
            return Ok(None);
        }
        let safe: SafeUser = user.into();
        let token = self.sign_token(&safe)?;
        Ok(Some(LoginResult { user: safe, token }))
    }

    pub async fn resolve_user(&self, token: Option<&str>) -> anyhow::Result<Option<SafeUser>> {
        let Some(token) = token else {
            return Ok(None);
        };
        let Some(payload) = self.verify_token(token) else {
            return Ok(None);
        };
        let Some(user) = self.store.find_user_by_id(&payload.sub).await? else {
            return Ok(None);
        };
        Ok(Some(user.into()))
    }
}

#[derive(Debug, serde::Serialize)]
pub struct LoginResult {
    pub user: SafeUser,
    pub token: String,
}
