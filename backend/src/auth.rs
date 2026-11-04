use axum::{
    async_trait,
    extract::FromRequestParts,
    http::request::Parts,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::sync::Arc;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub user_id: i64,
    pub username: String,
    pub is_admin: bool,
    pub exp: u64,
}

#[async_trait]
impl<S> FromRequestParts<S> for SessionData
where
    S: Send + Sync,
{
    type Rejection = (axum::http::StatusCode, String);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // 1. Check legacy fixed token (dome/domeneo) in Authorization header
        if let Some(auth) = parts.headers.get(axum::http::header::AUTHORIZATION) {
            if let Ok(val) = auth.to_str() {
                if val == format!("Bearer {}", crate::FIXED_TOKEN) {
                    return Ok(SessionData {
                        user_id: 1,
                        username: crate::FIXED_USER.to_string(),
                        is_admin: true,
                        exp: u64::MAX,
                    });
                }
            }
        }

        // 2. Get cookie secret from extensions
        let secret = parts
            .extensions
            .get::<Arc<String>>()
            .ok_or((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Missing cookie secret".into(),
            ))?
            .clone();

        // Parse Cookie header
        let cookie_header = parts
            .headers
            .get(axum::http::header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .ok_or((
                axum::http::StatusCode::UNAUTHORIZED,
                "No session cookie".into(),
            ))?;

        let session_value = cookie_header
            .split(';')
            .find_map(|part| {
                let trimmed = part.trim();
                if let Some(val) = trimmed.strip_prefix("session=") {
                    Some(val.to_string())
                } else {
                    None
                }
            })
            .ok_or((
                axum::http::StatusCode::UNAUTHORIZED,
                "No session cookie".into(),
            ))?;

        // Format: "PAYLOAD_B64.SIG_B64"
        let dot = session_value
            .rfind('.')
            .ok_or((axum::http::StatusCode::UNAUTHORIZED, "Invalid session".into()))?;

        let payload_b64 = &session_value[..dot];
        let sig_b64 = &session_value[dot + 1..];

        // Verify HMAC
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
            .map_err(|_| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "HMAC error".into()))?;
        mac.update(payload_b64.as_bytes());
        let expected_sig = B64.encode(mac.finalize().into_bytes());

        if sig_b64 != expected_sig {
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                "Invalid session signature".into(),
            ));
        }

        // Decode payload
        let payload_json = B64
            .decode(payload_b64)
            .map_err(|_| (axum::http::StatusCode::UNAUTHORIZED, "Invalid session payload".into()))?;

        let data: SessionData = serde_json::from_slice(&payload_json)
            .map_err(|_| (axum::http::StatusCode::UNAUTHORIZED, "Invalid session data".into()))?;

        // Check expiration
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        if data.exp < now {
            return Err((axum::http::StatusCode::UNAUTHORIZED, "Session expired".into()));
        }

        Ok(data)
    }
}

/// Signs session data → "PAYLOAD_B64.SIG_B64" cookie value
pub fn create_session_cookie(data: &SessionData, secret: &str) -> String {
    let payload_json = serde_json::to_string(data).unwrap();
    let payload_b64 = B64.encode(&payload_json);

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(payload_b64.as_bytes());
    let sig_b64 = B64.encode(mac.finalize().into_bytes());

    format!("{}.{}", payload_b64, sig_b64)
}
