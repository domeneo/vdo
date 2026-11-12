use axum::{
    extract::{Extension, Json, Path},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth::{create_session_cookie, SessionData};
use crate::db::Db;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct GenericResp {
    pub success: bool,
    pub message: String,
}

// ---------- Login ----------
#[derive(Debug, Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
}

pub async fn user_login_handler(
    Extension(db): Extension<Arc<Db>>,
    Extension(secret): Extension<Arc<String>>,
    Json(payload): Json<LoginReq>,
) -> impl IntoResponse {
    let user = match db.get_user_by_name(&payload.username) {
        Ok(Some(u)) => u,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(GenericResp {
                    success: false,
                    message: "Invalid username or password".into(),
                }),
            )
                .into_response();
        }
    };

    if !verify(&payload.password, &user.password).unwrap_or(false) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(GenericResp {
                success: false,
                message: "Invalid username or password".into(),
            }),
        )
            .into_response();
    }

    let exp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 24 * 3600; // 24h

    let session = SessionData {
        user_id: user.id,
        username: user.username.clone(),
        is_admin: user.is_admin,
        exp,
    };

    let cookie_value = create_session_cookie(&session, &secret);

    let set_cookie = format!(
        "session={}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400",
        cookie_value
    );

    let body = axum::body::Body::from(
        serde_json::to_string(&GenericResp {
            success: true,
            message: format!("Welcome, {}!", user.username),
        })
        .unwrap(),
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(header::SET_COOKIE, set_cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body)
        .unwrap()
}

// ---------- Logout ----------
pub async fn logout_handler() -> impl IntoResponse {
    let clear_cookie = "session=; HttpOnly; Path=/; Max-Age=0";
    let body = axum::body::Body::from(
        serde_json::to_string(&GenericResp {
            success: true,
            message: "Logged out".into(),
        })
        .unwrap(),
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(header::SET_COOKIE, clear_cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body)
        .unwrap()
}

// ---------- Get Current Session Info ----------
pub async fn whoami_handler(session: SessionData) -> impl IntoResponse {
    #[derive(Serialize)]
    struct WhoAmI {
        user_id: i64,
        username: String,
        is_admin: bool,
    }
    (
        StatusCode::OK,
        Json(WhoAmI {
            user_id: session.user_id,
            username: session.username,
            is_admin: session.is_admin,
        }),
    )
}

// ---------- Create User (admin only) ----------
#[derive(Debug, Deserialize)]
pub struct CreateUserReq {
    pub username: String,
    pub password: String,
    pub is_admin: bool,
}

pub async fn create_user_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Json(payload): Json<CreateUserReq>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }
    let pw_hash = match hash(&payload.password, DEFAULT_COST) {
        Ok(h) => h,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(GenericResp {
                    success: false,
                    message: e.to_string(),
                }),
            )
        }
    };
    match db.create_user(&payload.username, &pw_hash, payload.is_admin) {
        Ok(_) => (
            StatusCode::CREATED,
            Json(GenericResp {
                success: true,
                message: format!("User '{}' created", payload.username),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

// ---------- List Users (admin only) ----------
pub async fn list_users_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Admin only"})),
        );
    }
    let users = db.list_users().unwrap_or_default();
    (StatusCode::OK, Json(serde_json::to_value(users).unwrap()))
}

// ---------- Delete User (admin only) ----------
pub async fn delete_user_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Path(user_id): Path<i64>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }
    if user_id == session.user_id {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenericResp {
                success: false,
                message: "Cannot delete yourself".into(),
            }),
        );
    }
    match db.delete_user(user_id) {
        Ok(_) => (
            StatusCode::OK,
            Json(GenericResp {
                success: true,
                message: "User deleted".into(),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

// ---------- Folder list ----------
pub async fn list_folders_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
) -> impl IntoResponse {
    if session.is_admin {
        let folders = db.list_folders_with_visibility().unwrap_or_default();
        (StatusCode::OK, Json(serde_json::to_value(folders).unwrap()))
    } else {
        let folders = db.visible_folders_for_user(session.user_id).unwrap_or_default();
        (StatusCode::OK, Json(serde_json::to_value(folders).unwrap()))
    }
}

// ---------- Hide folder (admin only) ----------
pub async fn hide_folder_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Path(folder_id): Path<i64>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }
    match db.list_non_admin_user_ids() {
        Ok(user_ids) => {
            for uid in user_ids {
                let _ = db.hide_folder_for_user(uid, folder_id);
            }
            (
                StatusCode::OK,
                Json(GenericResp {
                    success: true,
                    message: "Folder hidden for all regular users".into(),
                }),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

// ---------- Show folder (admin only) ----------
pub async fn show_folder_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Path(folder_id): Path<i64>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }
    match db.list_non_admin_user_ids() {
        Ok(user_ids) => {
            for uid in user_ids {
                let _ = db.show_folder_for_user(uid, folder_id);
            }
            (
                StatusCode::OK,
                Json(GenericResp {
                    success: true,
                    message: "Folder visible for all regular users".into(),
                }),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

// ---------- Admin System Settings (Folder path, Excludes) ----------
#[derive(Debug, Serialize, Deserialize)]
pub struct SystemSettingsDto {
    pub video_root_path: String,
    pub excluded_folders: String,
}

pub async fn get_settings_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Admin only"})),
        );
    }
    let video_root_path = db.get_setting("video_root_path").unwrap_or(None).unwrap_or_default();
    let excluded_folders = db.get_setting("excluded_folders").unwrap_or(None).unwrap_or_default();
    (
        StatusCode::OK,
        Json(serde_json::to_value(SystemSettingsDto {
            video_root_path,
            excluded_folders,
        }).unwrap()),
    )
}

pub async fn update_settings_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Json(payload): Json<SystemSettingsDto>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }

    let target_path = payload.video_root_path.trim();
    if !target_path.is_empty() {
        let p = std::path::Path::new(target_path);
        if !p.exists() {
            return (
                StatusCode::BAD_REQUEST,
                Json(GenericResp {
                    success: false,
                    message: format!("ไม่พบโฟลเดอร์หรือเข้าถึงปลายทางไม่ได้: {}", target_path),
                }),
            );
        }
        // Update in-memory AppState
        if let Ok(mut base_lock) = state.base_video_path.write() {
            *base_lock = std::path::PathBuf::from(target_path);
        }
    }

    let _ = db.set_setting("video_root_path", target_path);
    let _ = db.set_setting("excluded_folders", payload.excluded_folders.trim());

    (
        StatusCode::OK,
        Json(GenericResp {
            success: true,
            message: "บันทึกการตั้งค่าโฟลเดอร์สำเร็จ!".into(),
        }),
    )
}
// ---------- Additional Folders (Multi-Folder & Shared Network Drives) ----------
#[derive(Debug, Deserialize)]
pub struct AddAdditionalFolderReq {
    pub name: String,
    pub path: String,
    pub excluded_folders: Option<String>,
    pub hidden_for_normal_users: Option<String>,
}

pub async fn list_additional_folders_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Admin only"})),
        );
    }
    let list = db.list_additional_folders().unwrap_or_default();
    (StatusCode::OK, Json(serde_json::to_value(list).unwrap()))
}

pub async fn create_additional_folder_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Json(payload): Json<AddAdditionalFolderReq>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }

    let folder_name = payload.name.trim();
    let folder_path = payload.path.trim();
    let excluded = payload.excluded_folders.unwrap_or_default();
    let hidden = payload.hidden_for_normal_users.unwrap_or_default();

    if folder_name.is_empty() || folder_path.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenericResp {
                success: false,
                message: "กรุณาระบุชื่อโฟลเดอร์และพาธให้ครบถ้วน".into(),
            }),
        );
    }

    if !folder_path.starts_with(r"\\") {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenericResp {
                success: false,
                message: "พาธต้องเป็นรูปแบบ Network Share เท่านั้น (ขึ้นต้นด้วย \\\\ เช่น \\\\192.168.1.242\\plex$\\VDO)".into(),
            }),
        );
    }

    let p = std::path::Path::new(folder_path);
    if !p.exists() {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenericResp {
                success: false,
                message: format!("ไม่พบโฟลเดอร์หรือเข้าถึงปลายทางไม่ได้: {}", folder_path),
            }),
        );
    }

    match db.add_additional_folder(folder_name, folder_path, excluded.trim(), hidden.trim()) {
        Ok(_) => (
            StatusCode::OK,
            Json(GenericResp {
                success: true,
                message: format!("เพิ่มโฟลเดอร์ '{}' เรียบร้อยแล้ว!", folder_name),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

pub async fn update_additional_folder_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Path(id): Path<i64>,
    Json(payload): Json<AddAdditionalFolderReq>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }

    let folder_name = payload.name.trim();
    let folder_path = payload.path.trim();
    let excluded = payload.excluded_folders.unwrap_or_default();
    let hidden = payload.hidden_for_normal_users.unwrap_or_default();

    if folder_name.is_empty() || folder_path.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenericResp {
                success: false,
                message: "กรุณาระบุชื่อโฟลเดอร์และพาธให้ครบถ้วน".into(),
            }),
        );
    }

    if !folder_path.starts_with(r"\\") {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenericResp {
                success: false,
                message: "พาธต้องเป็นรูปแบบ Network Share เท่านั้น (ขึ้นต้นด้วย \\\\ เช่น \\\\192.168.1.242\\plex$\\VDO)".into(),
            }),
        );
    }

    let p = std::path::Path::new(folder_path);
    if !p.exists() {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenericResp {
                success: false,
                message: format!("ไม่พบโฟลเดอร์หรือเข้าถึงปลายทางไม่ได้: {}", folder_path),
            }),
        );
    }

    match db.update_additional_folder(id, folder_name, folder_path, excluded.trim(), hidden.trim()) {
        Ok(_) => (
            StatusCode::OK,
            Json(GenericResp {
                success: true,
                message: format!("แก้ไขโฟลเดอร์ '{}' เรียบร้อยแล้ว!", folder_name),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

pub async fn delete_additional_folder_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }
    match db.delete_additional_folder(id) {
        Ok(_) => (
            StatusCode::OK,
            Json(GenericResp {
                success: true,
                message: "ลบโฟลเดอร์เพิ่มเติมสำเร็จ!".into(),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

// ---------- Playback Progress (Per User & Video) ----------
#[derive(Debug, Deserialize)]
pub struct SaveProgressReq {
    pub video_path: String,
    pub start_time: f64,
    pub quality: Option<String>,
    pub subtitle_id: Option<i64>,
    pub audio_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct GetProgressQuery {
    pub file: String,
}

pub async fn save_progress_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Json(payload): Json<SaveProgressReq>,
) -> impl IntoResponse {
    let video_path = payload.video_path.trim();
    if video_path.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(GenericResp {
                success: false,
                message: "Video path cannot be empty".into(),
            }),
        );
    }

    match db.save_playback_progress(
        session.user_id,
        video_path,
        payload.start_time,
        payload.quality.as_deref(),
        payload.subtitle_id,
        payload.audio_id,
    ) {
        Ok(_) => (
            StatusCode::OK,
            Json(GenericResp {
                success: true,
                message: "Progress saved".into(),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

pub async fn get_progress_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    axum::extract::Query(query): axum::extract::Query<GetProgressQuery>,
) -> impl IntoResponse {
    match db.get_playback_progress(session.user_id, &query.file) {
        Ok(Some(prog)) => (StatusCode::OK, Json(serde_json::to_value(prog).unwrap())),
        Ok(None) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "user_id": session.user_id,
                "video_path": query.file,
                "start_time": 0.0,
                "quality": null,
                "subtitle_id": null,
                "audio_id": null,
                "rectime": null
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

pub async fn sync_folders_handler(
    Extension(db): Extension<Arc<Db>>,
    session: SessionData,
    Json(folders): Json<Vec<crate::db::FolderInput>>,
) -> impl IntoResponse {
    if !session.is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(GenericResp {
                success: false,
                message: "Admin only".into(),
            }),
        );
    }
    match db.sync_folders(&folders) {
        Ok(_) => (
            StatusCode::OK,
            Json(GenericResp {
                success: true,
                message: "Folders synced".into(),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericResp {
                success: false,
                message: e.to_string(),
            }),
        ),
    }
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/user/login", post(user_login_handler))
        .route("/api/user/logout", post(logout_handler))
        .route("/api/user/whoami", get(whoami_handler))
        .route("/api/users", get(list_users_handler).post(create_user_handler))
        .route("/api/users/:id", delete(delete_user_handler))
        .route("/api/admin/folders", get(list_folders_handler))
        .route("/api/admin/folders/sync", post(sync_folders_handler))
        .route("/api/admin/folders/:id/hide", post(hide_folder_handler))
        .route("/api/admin/folders/:id/show", post(show_folder_handler))
}
