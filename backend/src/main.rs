mod db;
mod auth;
mod user_routes;

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, Request, State, Extension},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, Json, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, RwLock},
};
use tokio::{
    fs,
    process::Command,
};
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use db::Db;

pub const FIXED_USER: &str = "dome";
pub const FIXED_PASS: &str = "domeneo";
pub const FIXED_TOKEN: &str = "token_dome_authenticated_session_secret";

#[derive(Clone)]
pub struct AppState {
    pub base_video_path: Arc<RwLock<PathBuf>>,
    pub cache_dir: PathBuf,
    pub server_port: u16,
    pub ffmpeg_path: PathBuf,
    pub ffprobe_path: PathBuf,
}

#[derive(Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize, Deserialize)]
pub struct LoginResponse {
    pub success: bool,
    pub token: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FsItem {
    pub name: String,
    pub is_dir: bool,
    pub relative_path: String,
    pub size: Option<u64>,
    #[serde(default)]
    pub is_additional: bool,
}

#[derive(Deserialize)]
pub struct FsQuery {
    pub path: Option<String>,
}

#[derive(Deserialize)]
pub struct VideoQuery {
    pub file: String,
}

#[derive(Deserialize)]
pub struct TranscodeQuery {
    pub file: String,
    pub quality: Option<String>,
    pub start: Option<f64>,
    pub sub: Option<String>,
    pub audio: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubtitleTrack {
    pub id: usize,
    pub title: String,
    pub language: String,
    pub vtt_url: String,
    pub is_bitmap: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AudioTrack {
    pub id: usize,
    pub title: String,
    pub language: String,
    pub codec: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MediaTracks {
    pub subtitles: Vec<SubtitleTrack>,
    pub audio_tracks: Vec<AudioTrack>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(4103);

    let base_path = if let Ok(custom) = std::env::var("VIDEO_ROOT_PATH") {
        PathBuf::from(custom)
    } else if Path::new(r"E:\plex").exists() {
        PathBuf::from(r"E:\plex")
    } else if Path::new(r"\\192.168.1.242\e$\plex").exists() {
        PathBuf::from(r"\\192.168.1.242\e$\plex")
    } else {
        PathBuf::from("storage/videos")
    };

    let ffmpeg_path = if Path::new(r"E:\ffmpeg\bin\ffmpeg.exe").exists() {
        PathBuf::from(r"E:\ffmpeg\bin\ffmpeg.exe")
    } else if Path::new(r"\\192.168.1.242\e$\ffmpeg\bin\ffmpeg.exe").exists() {
        PathBuf::from(r"\\192.168.1.242\e$\ffmpeg\bin\ffmpeg.exe")
    } else {
        PathBuf::from("ffmpeg")
    };

    let ffprobe_path = if Path::new(r"E:\ffmpeg\bin\ffprobe.exe").exists() {
        PathBuf::from(r"E:\ffmpeg\bin\ffprobe.exe")
    } else if Path::new(r"\\192.168.1.242\e$\ffmpeg\bin\ffprobe.exe").exists() {
        PathBuf::from(r"\\192.168.1.242\e$\ffmpeg\bin\ffprobe.exe")
    } else {
        PathBuf::from("ffprobe")
    };

    let cache_dir = PathBuf::from("storage/cache");
    let _ = fs::create_dir_all(&cache_dir).await;
    let _ = fs::create_dir_all(cache_dir.join("subs")).await;

    tracing::info!("📁 Video Root: {:?}", base_path);
    tracing::info!("🎬 FFmpeg Path: {:?}", ffmpeg_path);
    tracing::info!("🔍 FFprobe Path: {:?}", ffprobe_path);

    // --- SQLite DB (always next to the executable) ---
    let db_path = std::env::var("DB_PATH").unwrap_or_else(|_| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("vdo.sqlite")))
            .unwrap_or_else(|| std::path::PathBuf::from("vdo.sqlite"))
            .to_string_lossy()
            .to_string()
    });
    let db = Arc::new(Db::new(&db_path).expect("Failed to open SQLite database"));

    // Check if there is a configured custom video_root_path in DB
    let configured_base = if let Ok(Some(saved_path)) = db.get_setting("video_root_path") {
        if !saved_path.is_empty() {
            PathBuf::from(saved_path)
        } else {
            base_path
        }
    } else {
        base_path
    };

    // --- Cookie secret ---
    let cookie_secret = std::env::var("COOKIE_SECRET")
        .unwrap_or_else(|_| "vdo_default_super_secret_key_32bytes!".to_string());
    let cookie_secret = Arc::new(cookie_secret);

    let state = Arc::new(AppState {
        base_video_path: Arc::new(RwLock::new(configured_base)),
        cache_dir,
        server_port: port,
        ffmpeg_path,
        ffprobe_path,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let static_dist = PathBuf::from("dist");

    let app = Router::new()
        // --- original routes ---
        .route("/health", get(health_check))
        .route("/api/auth/login", post(login_handler))
        .route("/api/fs", get(list_directory))
        .route("/api/tracks", get(get_media_tracks))
        .route("/api/stream", get(stream_video_direct))
        .route("/api/stream/transcode", get(stream_video_transcode))
        .route("/api/stream/hls/playlist.m3u8", get(proxy_hls_playlist))
        .route("/api/stream/hls/segment.ts", get(proxy_hls_segment))
        .route("/stream/subs/:hash/:filename", get(serve_subtitle))
        // --- user management routes ---
        .route("/api/user/login", post(user_routes::user_login_handler))
        .route("/api/user/logout", post(user_routes::logout_handler))
        .route("/api/user/whoami", get(user_routes::whoami_handler))
        .route("/api/users", get(user_routes::list_users_handler).post(user_routes::create_user_handler))
        .route("/api/users/:id", axum::routing::delete(user_routes::delete_user_handler))
        .route("/api/admin/folders", get(user_routes::list_folders_handler))
        .route("/api/admin/folders/sync", post(user_routes::sync_folders_handler))
        .route("/api/admin/folders/:id/hide", post(user_routes::hide_folder_handler))
        .route("/api/admin/folders/:id/show", post(user_routes::show_folder_handler))
        .route("/api/admin/settings", get(user_routes::get_settings_handler).post(user_routes::update_settings_handler))
        .route("/api/admin/additional-folders", get(user_routes::list_additional_folders_handler).post(user_routes::create_additional_folder_handler))
        .route("/api/admin/additional-folders/:id", axum::routing::delete(user_routes::delete_additional_folder_handler))
        .route("/api/video/progress", get(user_routes::get_progress_handler).post(user_routes::save_progress_handler))
        .fallback_service(
            ServeDir::new(&static_dist)
                .not_found_service(ServeFile::new(static_dist.join("index.html"))),
        )
        .layer(cors)
        .layer(Extension(cookie_secret))
        .layer(Extension(db))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("🦀 Rust Video Server listening on http://0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> Html<&'static str> {
    Html(r#"
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Rust Video Server - Status OK</title>
            <style>
                body { background-color: #09090b; color: #f4f4f5; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #18181b; padding: 2.5rem; border-radius: 1.25rem; border: 1px solid #27272a; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
                .badge { background: #064e3b; color: #34d399; padding: 0.35rem 1rem; border-radius: 9999px; font-weight: 600; font-size: 0.875rem; display: inline-block; margin-bottom: 1rem; }
                h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
                p { color: #a1a1aa; margin: 0; font-size: 0.95rem; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="badge">● Online &amp; Ready</div>
                <h1>🦀 Rust Video Backend is Running!</h1>
                <p>Cloudflare Tunnel (api-vdo.thaiswan.com) เชื่อมต่อสำเร็จ 100%</p>
            </div>
        </body>
        </html>
    "#)
}

async fn login_handler(Json(payload): Json<LoginRequest>) -> Json<LoginResponse> {
    if payload.username == FIXED_USER && payload.password == FIXED_PASS {
        Json(LoginResponse {
            success: true,
            token: Some(FIXED_TOKEN.to_string()),
            message: "เข้าสู่ระบบสำเร็จ".to_string(),
        })
    } else {
        Json(LoginResponse {
            success: false,
            token: None,
            message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง".to_string(),
        })
    }
}

fn resolve_media_path(
    base: &Path,
    additional_folders: &[db::AdditionalFolder],
    file_rel: &str,
) -> Option<PathBuf> {
    // 1. Check if file_rel starts with an additional folder prefix: "folder_name/..."
    let normalized = file_rel.replace('\\', "/");
    for af in additional_folders {
        let prefix = format!("{}/", af.name);
        if normalized.starts_with(&prefix) {
            let sub_path = &normalized[prefix.len()..];
            let target = PathBuf::from(&af.path).join(sub_path);
            if target.exists() {
                return Some(target);
            }
        } else if normalized == af.name {
            let target = PathBuf::from(&af.path);
            if target.exists() {
                return Some(target);
            }
        }
    }

    // 2. Default to primary base video path
    let target = base.join(file_rel);
    if target.exists() {
        Some(target)
    } else {
        None
    }
}
fn verify_auth_or_session(
    headers: &HeaderMap,
    secret: &str,
    db: &Db,
) -> Option<(bool, Vec<String>)> {
    // 1. Check legacy/master Bearer token (has full admin access)
    if let Some(auth) = headers.get("authorization") {
        if let Ok(val) = auth.to_str() {
            if val == format!("Bearer {}", FIXED_TOKEN) {
                return Some((true, Vec::new()));
            }
        }
    }

    // 2. Check Cookie session
    if let Some(cookie_header) = headers.get(axum::http::header::COOKIE).and_then(|v| v.to_str().ok()) {
        let session_cookie = cookie_header.split(';').find_map(|p| {
            let trimmed = p.trim();
            trimmed.strip_prefix("session=").map(|s| s.to_string())
        });

        if let Some(session_val) = session_cookie {
            if let Some(dot) = session_val.rfind('.') {
                let payload_b64 = &session_val[..dot];
                let sig_b64 = &session_val[dot + 1..];

                use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
                use hmac::{Hmac, Mac};
                use sha2::Sha256;
                type HmacSha256 = Hmac<Sha256>;

                if let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) {
                    mac.update(payload_b64.as_bytes());
                    let expected_sig = B64.encode(mac.finalize().into_bytes());
                    if sig_b64 == expected_sig {
                        if let Ok(payload_json) = B64.decode(payload_b64) {
                            if let Ok(sess) = serde_json::from_slice::<auth::SessionData>(&payload_json) {
                                let now = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs();
                                if sess.exp >= now {
                                    if sess.is_admin {
                                        return Some((true, Vec::new()));
                                    } else {
                                        let hidden = db.get_hidden_folder_names_for_user(sess.user_id);
                                        return Some((false, hidden));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

async fn list_directory(
    State(state): State<Arc<AppState>>,
    Extension(secret): Extension<Arc<String>>,
    Extension(db): Extension<Arc<Db>>,
    headers: HeaderMap,
    Query(query): Query<FsQuery>,
) -> Result<Json<Vec<FsItem>>, StatusCode> {
    let auth_info = match verify_auth_or_session(&headers, &secret, &db) {
        Some(info) => info,
        None => return Err(StatusCode::UNAUTHORIZED),
    };
    let (_is_admin, hidden_folders) = auth_info;

    let rel = query.path.unwrap_or_default();
    let base = state.base_video_path.read().unwrap().clone();
    let additional_folders = db.list_additional_folders().unwrap_or_default();

    // Determine target directory: either from additional folders or base path
    let (current_dir, is_top_level_of_source, source_excludes) = if rel.is_empty() {
        (base.clone(), true, Vec::new())
    } else {
        let normalized = rel.replace('\\', "/");
        let mut matched_af = None;
        for af in &additional_folders {
            let prefix = format!("{}/", af.name);
            if normalized.starts_with(&prefix) {
                let sub_path = &normalized[prefix.len()..];
                matched_af = Some((PathBuf::from(&af.path).join(sub_path), false, Vec::new()));
                break;
            } else if normalized == af.name {
                let excludes: Vec<String> = af.excluded_folders
                    .split(',')
                    .map(|s| s.trim().to_uppercase())
                    .filter(|s| !s.is_empty())
                    .collect();
                matched_af = Some((PathBuf::from(&af.path), true, excludes));
                break;
            }
        }

        if let Some(res) = matched_af {
            res
        } else {
            let p = base.join(&rel);
            if !p.starts_with(&base) {
                return Err(StatusCode::FORBIDDEN);
            }
            (p, false, Vec::new())
        }
    };

    // Load top-level excluded folders from DB
    let excluded_setting = db.get_setting("excluded_folders").unwrap_or(None).unwrap_or_default();
    let user_excluded: Vec<String> = if rel.is_empty() {
        excluded_setting
            .split(',')
            .map(|s| s.trim().to_uppercase())
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        source_excludes
    };

    let mut entries = match fs::read_dir(&current_dir).await {
        Ok(e) => e,
        Err(_) => return Err(StatusCode::NOT_FOUND),
    };

    let mut items = Vec::new();
    let mut add_items = Vec::new();

    // If at root (rel.is_empty()), inject additional folders as directories!
    if rel.is_empty() {
        for af in &additional_folders {
            // Check if hidden for user
            if hidden_folders.contains(&af.name) {
                continue;
            }
            add_items.push(FsItem {
                name: af.name.clone(),
                is_dir: true,
                relative_path: af.name.clone(),
                size: None,
                is_additional: true,
            });
        }
    }

    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();

        let upper_name = name.to_uppercase();
        if upper_name == "PIC"
            || upper_name.starts_with('$')
            || upper_name == "SYSTEM VOLUME INFORMATION"
            || (is_top_level_of_source && user_excluded.contains(&upper_name))
        {
            continue;
        }

        // Filter out folders that are hidden for regular users
        if rel.is_empty() && hidden_folders.contains(&name) {
            continue;
        }

        if let Ok(meta) = entry.metadata().await {
            let is_dir = meta.is_dir();
            let relative_child = if rel.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel, name)
            };

            if is_dir {
                items.push(FsItem {
                    name,
                    is_dir: true,
                    relative_path: relative_child,
                    size: None,
                    is_additional: false,
                });
            } else {
                let ext = Path::new(&name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                if ["mkv", "mp4", "avi", "mov", "m4v"].contains(&ext.as_str()) {
                    items.push(FsItem {
                        name,
                        is_dir: false,
                        relative_path: relative_child,
                        size: Some(meta.len()),
                        is_additional: false,
                    });
                }
            }
        }
    }

    items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    add_items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    items.extend(add_items);

    Ok(Json(items))
}

async fn get_media_tracks(
    State(state): State<Arc<AppState>>,
    Extension(secret): Extension<Arc<String>>,
    Extension(db): Extension<Arc<Db>>,
    headers: HeaderMap,
    Query(query): Query<VideoQuery>,
) -> Result<Json<MediaTracks>, StatusCode> {
    if verify_auth_or_session(&headers, &secret, &db).is_none() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let base = state.base_video_path.read().unwrap().clone();
    let additional_folders = db.list_additional_folders().unwrap_or_default();
    let full_path = match resolve_media_path(&base, &additional_folders, &query.file) {
        Some(p) => p,
        None => return Err(StatusCode::NOT_FOUND),
    };

    let file_hash = format!("{:x}", md5::compute(query.file.as_bytes()));
    let subs_dir = state.cache_dir.join("subs").join(&file_hash);
    let _ = fs::create_dir_all(&subs_dir).await;

    let probe_output = Command::new(&state.ffprobe_path)
        .args([
            "-v",
            "error",
            "-probesize",
            "10000000",
            "-analyzeduration",
            "10000000",
            "-show_entries",
            "stream=index,codec_type,codec_name:stream_tags=language,title",
            "-of",
            "json",
            full_path.to_str().unwrap(),
        ])
        .output()
        .await;

    let mut subtitles = Vec::new();
    let mut audio_tracks = Vec::new();
    let mut missing_subs: Vec<(usize, PathBuf)> = Vec::new();

    if let Ok(output) = probe_output {
        if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
            if let Some(streams) = parsed["streams"].as_array() {
                for (i, stream) in streams.iter().enumerate() {
                    let index = stream["index"].as_u64().unwrap_or(i as u64) as usize;
                    let codec_type = stream["codec_type"].as_str().unwrap_or("");
                    let codec_name = stream["codec_name"].as_str().unwrap_or("").to_lowercase();
                    let lang = stream["tags"]["language"]
                        .as_str()
                        .unwrap_or("und")
                        .to_string();
                    let title = stream["tags"]["title"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();

                    if codec_type == "subtitle" {
                        let is_bitmap = codec_name.contains("pgs") || codec_name.contains("dvd") || codec_name.contains("vobsub");

                        let sub_title = if !title.is_empty() {
                            format!("{} ({})", title, lang)
                        } else {
                            format!("Subtitle {} ({})", subtitles.len() + 1, lang)
                        };

                        let vtt_filename = format!("sub_{}.vtt", index);
                        let vtt_path = subs_dir.join(&vtt_filename);

                        if !is_bitmap {
                            let need_extract = match fs::metadata(&vtt_path).await {
                                Ok(m) => m.len() == 0,
                                Err(_) => true,
                            };

                            if need_extract {
                                missing_subs.push((index, vtt_path));
                            }
                        }

                        subtitles.push(SubtitleTrack {
                            id: index,
                            title: sub_title,
                            language: lang,
                            vtt_url: if is_bitmap {
                                String::new()
                            } else {
                                format!("/stream/subs/{}/{}", file_hash, vtt_filename)
                            },
                            is_bitmap,
                        });
                    } else if codec_type == "audio" {
                        let audio_title = if !title.is_empty() {
                            format!("{} ({})", title, lang)
                        } else {
                            format!("Audio {} ({})", audio_tracks.len() + 1, lang)
                        };

                        audio_tracks.push(AudioTrack {
                            id: index,
                            title: audio_title,
                            language: lang,
                            codec: codec_name,
                        });
                    }
                }
            }
        }
    }

    if !missing_subs.is_empty() {
        let ffmpeg_path = state.ffmpeg_path.clone();
        let video_path = full_path.clone();

        tokio::spawn(async move {
            let mut cmd = Command::new(&ffmpeg_path);
            cmd.arg("-y").arg("-i").arg(&video_path);
            for (idx, path) in &missing_subs {
                cmd.arg("-map")
                    .arg(format!("0:{}", idx))
                    .arg("-c:s")
                    .arg("webvtt")
                    .arg(path);
            }
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
            let status = cmd.status().await;
            tracing::info!("Subtitle single-pass extraction finished: {:?}", status);
        });
    }

    Ok(Json(MediaTracks {
        subtitles,
        audio_tracks,
    }))
}

async fn serve_subtitle(
    State(state): State<Arc<AppState>>,
    AxumPath((hash, filename)): AxumPath<(String, String)>,
) -> Result<Response, StatusCode> {
    if hash.contains("..")
        || filename.contains("..")
        || hash.contains('/')
        || hash.contains('\\')
        || filename.contains('/')
        || filename.contains('\\')
    {
        return Err(StatusCode::FORBIDDEN);
    }

    let sub_file = state.cache_dir.join("subs").join(&hash).join(&filename);

    for _ in 0..50 {
        if sub_file.exists() {
            if let Ok(meta) = fs::metadata(&sub_file).await {
                if meta.len() > 0 {
                    let serve = ServeFile::new(&sub_file);
                    let req = axum::extract::Request::builder().body(Body::empty()).unwrap();
                    let res = tower::ServiceExt::oneshot(serve, req).await;
                    match res {
                        Ok(res) => {
                            let mut response = res.map(Body::new);
                            response.headers_mut().insert(
                                header::CONTENT_TYPE,
                                HeaderValue::from_static("text/vtt; charset=utf-8"),
                            );
                            response.headers_mut().insert(
                                header::CACHE_CONTROL,
                                HeaderValue::from_static("public, max-age=86400"),
                            );
                            return Ok(response);
                        }
                        Err(_) => {}
                    }
                }
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }

    Err(StatusCode::NOT_FOUND)
}

async fn stream_video_direct(
    State(state): State<Arc<AppState>>,
    Extension(db): Extension<Arc<Db>>,
    Query(query): Query<VideoQuery>,
    req: Request,
) -> Result<Response, StatusCode> {
    let base = state.base_video_path.read().unwrap().clone();
    let additional_folders = db.list_additional_folders().unwrap_or_default();
    let full_path = match resolve_media_path(&base, &additional_folders, &query.file) {
        Some(p) => p,
        None => return Err(StatusCode::NOT_FOUND),
    };

    let serve_file = ServeFile::new(full_path);
    match tower::ServiceExt::oneshot(serve_file, req).await {
        Ok(res) => Ok(res.map(Body::new)),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn proxy_hls_playlist(
    State(state): State<Arc<AppState>>,
    Extension(db): Extension<Arc<Db>>,
    Query(query): Query<TranscodeQuery>,
) -> Result<Response, StatusCode> {
    let base = state.base_video_path.read().unwrap().clone();
    let additional_folders = db.list_additional_folders().unwrap_or_default();
    let file_to_send = match resolve_media_path(&base, &additional_folders, &query.file) {
        Some(p) => p.to_string_lossy().to_string(),
        None => query.file.clone(),
    };

    let quality = query.quality.unwrap_or_else(|| "720p".to_string());
    let mut worker_url = format!(
        "http://192.168.1.40:4105/hls/playlist.m3u8?file={}&quality={}",
        urlencoding::encode(&file_to_send),
        urlencoding::encode(&quality)
    );
    if let Some(ref sub) = query.sub {
        worker_url.push_str(&format!("&sub={}", urlencoding::encode(sub)));
    }
    if let Some(ref audio) = query.audio {
        worker_url.push_str(&format!("&audio={}", urlencoding::encode(audio)));
    }

    let client = reqwest::Client::new();
    let res = client.get(&worker_url).send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    if !res.status().is_success() {
        return Err(StatusCode::NOT_FOUND);
    }

    let text = res.text().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut response = Response::new(Body::from(text));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/vnd.apple.mpegurl"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache"),
    );

    Ok(response)
}

#[derive(Deserialize)]
pub struct HlsSegmentQuery {
    pub file: String,
    pub quality: Option<String>,
    pub index: Option<usize>,
    pub start: Option<f64>,
    pub duration: Option<f64>,
    pub sub: Option<String>,
    pub audio: Option<String>,
}

async fn proxy_hls_segment(
    State(state): State<Arc<AppState>>,
    Extension(db): Extension<Arc<Db>>,
    Query(query): Query<HlsSegmentQuery>,
) -> Result<Response, StatusCode> {
    let base = state.base_video_path.read().unwrap().clone();
    let additional_folders = db.list_additional_folders().unwrap_or_default();
    let file_to_send = match resolve_media_path(&base, &additional_folders, &query.file) {
        Some(p) => p.to_string_lossy().to_string(),
        None => query.file.clone(),
    };

    let quality = query.quality.unwrap_or_else(|| "720p".to_string());
    let start = query.start.unwrap_or(0.0);
    let duration = query.duration.unwrap_or(4.0);

    let mut worker_url = format!(
        "http://192.168.1.40:4105/hls/segment.ts?file={}&quality={}&start={}&duration={}",
        urlencoding::encode(&file_to_send),
        urlencoding::encode(&quality),
        start,
        duration
    );
    if let Some(ref sub) = query.sub {
        worker_url.push_str(&format!("&sub={}", urlencoding::encode(sub)));
    }
    if let Some(ref audio) = query.audio {
        worker_url.push_str(&format!("&audio={}", urlencoding::encode(audio)));
    }

    let client = reqwest::Client::new();
    let res = client.get(&worker_url).send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    if !res.status().is_success() {
        return Err(StatusCode::NOT_FOUND);
    }

    let stream = res.bytes_stream();
    let body = Body::from_stream(stream);

    let mut response = Response::new(body);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("video/mp2t"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400"),
    );

    Ok(response)
}

async fn stream_video_transcode(
    State(state): State<Arc<AppState>>,
    Extension(db): Extension<Arc<Db>>,
    Query(query): Query<TranscodeQuery>,
) -> Result<Response, StatusCode> {
    let base = state.base_video_path.read().unwrap().clone();
    let additional_folders = db.list_additional_folders().unwrap_or_default();
    let full_path = match resolve_media_path(&base, &additional_folders, &query.file) {
        Some(p) => p,
        None => return Err(StatusCode::NOT_FOUND),
    };

    let quality = query.quality.clone().unwrap_or_else(|| "720p".to_string());
    let start_sec = query.start.unwrap_or(0.0);

    let file_to_send = full_path.to_string_lossy().to_string();
    let worker_url = format!(
        "http://192.168.1.40:4105/transcode?file={}&quality={}&start={}",
        urlencoding::encode(&file_to_send),
        urlencoding::encode(&quality),
        start_sec
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_millis(1500))
        .build()
        .unwrap_or_default();

    if let Ok(worker_res) = client.get(&worker_url).send().await {
        if worker_res.status().is_success() {
            tracing::info!("🚀 Streaming via Remote Intel QSV Worker (192.168.1.40)");
            let stream = worker_res.bytes_stream();
            let body = Body::from_stream(stream);

            let mut response = Response::new(body);
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("video/mp4"),
            );
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-cache"),
            );
            return Ok(response);
        }
    }

    tracing::warn!("⚠️ Remote QSV Worker offline or failed, falling back to local CPU transcode");

    let (scale, video_bitrate, audio_bitrate, crf) = match quality.as_str() {
        "480p" => ("scale=-2:480", "900k", "96k", "28"),
        "360p" => ("scale=-2:360", "500k", "64k", "30"),
        _ => ("scale=-2:720", "2200k", "128k", "25"),
    };

    let mut cmd = Command::new(&state.ffmpeg_path);

    if start_sec > 0.0 {
        cmd.arg("-ss").arg(format!("{:.2}", start_sec));
    }

    cmd.args([
        "-i", full_path.to_str().unwrap(),
        "-vf", scale,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-crf", crf,
        "-maxrate", video_bitrate,
        "-bufsize", "4000k",
        "-threads", "3",
        "-c:a", "aac",
        "-b:a", audio_bitrate,
        "-ac", "2",
        "-f", "mp4",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1"
    ]);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to spawn ffmpeg transcode: {:?}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let stdout = child.stdout.take().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let stream = ReaderStream::new(stdout);
    let body = Body::from_stream(stream);

    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    let mut response = Response::new(body);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("video/mp4"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache"),
    );

    Ok(response)
}
