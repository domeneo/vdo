use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, Request, State},
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
    sync::Arc,
};
use tokio::{
    fs,
    process::Command,
};
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const FIXED_USER: &str = "dome";
const FIXED_PASS: &str = "domeneo";
const FIXED_TOKEN: &str = "token_dome_authenticated_session_secret";

#[derive(Clone)]
pub struct AppState {
    pub base_video_path: PathBuf,
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
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubtitleTrack {
    pub id: usize,
    pub title: String,
    pub language: String,
    pub vtt_url: String,
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

    let state = Arc::new(AppState {
        base_video_path: base_path,
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
        .route("/health", get(health_check))
        .route("/api/auth/login", post(login_handler))
        .route("/api/fs", get(list_directory))
        .route("/api/tracks", get(get_media_tracks))
        .route("/api/stream", get(stream_video_direct))
        .route("/api/stream/transcode", get(stream_video_transcode))
        .route("/api/stream/hls/playlist.m3u8", get(proxy_hls_playlist))
        .route("/api/stream/hls/segment.ts", get(proxy_hls_segment))
        .route("/stream/subs/:hash/:filename", get(serve_subtitle))
        .fallback_service(
            ServeDir::new(&static_dist)
                .not_found_service(ServeFile::new(static_dist.join("index.html"))),
        )
        .layer(cors)
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
                <div class="badge">● Online & Ready</div>
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

fn verify_auth(headers: &HeaderMap) -> bool {
    if let Some(auth) = headers.get("authorization") {
        if let Ok(val) = auth.to_str() {
            return val == format!("Bearer {}", FIXED_TOKEN);
        }
    }
    false
}

async fn list_directory(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<FsQuery>,
) -> Result<Json<Vec<FsItem>>, StatusCode> {
    if !verify_auth(&headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let rel = query.path.unwrap_or_default();
    let current_dir = state.base_video_path.join(&rel);

    if !current_dir.starts_with(&state.base_video_path) {
        return Err(StatusCode::FORBIDDEN);
    }

    let mut entries = match fs::read_dir(&current_dir).await {
        Ok(e) => e,
        Err(_) => return Err(StatusCode::NOT_FOUND),
    };

    let mut items = Vec::new();

    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();

        let upper_name = name.to_uppercase();
        if upper_name == "PIC"
            || upper_name.starts_with('$')
            || upper_name == "SYSTEM VOLUME INFORMATION"
        {
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

    Ok(Json(items))
}

async fn get_media_tracks(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<VideoQuery>,
) -> Result<Json<MediaTracks>, StatusCode> {
    if !verify_auth(&headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let full_path = state.base_video_path.join(&query.file);
    if !full_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

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
                        // ข้าม bitmap image subtitle (เช่น pgs/dvd) ที่แปลงเป็น WebVTT ตรงๆ ไม่ได้
                        if codec_name.contains("pgs") || codec_name.contains("dvd") {
                            continue;
                        }

                        let sub_title = if !title.is_empty() {
                            format!("{} ({})", title, lang)
                        } else {
                            format!("Subtitle {} ({})", subtitles.len() + 1, lang)
                        };

                        let vtt_filename = format!("sub_{}.vtt", index);
                        let vtt_path = subs_dir.join(&vtt_filename);

                        let need_extract = match fs::metadata(&vtt_path).await {
                            Ok(m) => m.len() == 0,
                            Err(_) => true,
                        };

                        if need_extract {
                            missing_subs.push((index, vtt_path));
                        }

                        subtitles.push(SubtitleTrack {
                            id: index,
                            title: sub_title,
                            language: lang,
                            vtt_url: format!("/stream/subs/{}/{}", file_hash, vtt_filename),
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

    // ถอดซับไตเติลที่ยังไม่มีทั้งหมดในรอบเดียว (Single-Pass Multi-output) ใน Background ทันที
    // ไม่บล็อก API response ทำให้หน้าเว็บได้ปุ่มเลือกซับภายใน 0.2 วินาที!
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

/// ส่งไฟล์ Subtitle (.vtt) หากไฟล์กำลังแปลงอยู่เบื้องหลัง จะรอจนกว่าจะเขียนเสร็จ (สูงสุด 10 วินาที)
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
                    if let Ok(res) = tower::ServiceExt::oneshot(serve, req).await {
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
                }
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }

    Err(StatusCode::NOT_FOUND)
}

/// สตรีมไฟล์ตรง (Direct Stream) ทันที เปิดติดแน่นอน 100% ไม่ต้องรอแปลงใดๆ ทั้งสิ้น
async fn stream_video_direct(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VideoQuery>,
    req: Request,
) -> Result<Response, StatusCode> {
    let full_path = state.base_video_path.join(&query.file);
    if !full_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let serve_file = ServeFile::new(full_path);
    match tower::ServiceExt::oneshot(serve_file, req).await {
        Ok(res) => Ok(res.map(Body::new)),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Proxy HLS Playlist จากเครื่อง Pentium Gold Worker (192.168.1.40)
async fn proxy_hls_playlist(
    Query(query): Query<TranscodeQuery>,
) -> Result<Response, StatusCode> {
    let quality = query.quality.unwrap_or_else(|| "720p".to_string());
    let worker_url = format!(
        "http://192.168.1.40:4105/hls/playlist.m3u8?file={}&quality={}",
        urlencoding::encode(&query.file),
        urlencoding::encode(&quality)
    );

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
}

/// Proxy HLS TS Segment ที่แปลงสดโดยชิป Intel UHD 710 QSV
async fn proxy_hls_segment(
    Query(query): Query<HlsSegmentQuery>,
) -> Result<Response, StatusCode> {
    let quality = query.quality.unwrap_or_else(|| "720p".to_string());
    let start = query.start.unwrap_or(0.0);
    let duration = query.duration.unwrap_or(4.0);

    let worker_url = format!(
        "http://192.168.1.40:4105/hls/segment.ts?file={}&quality={}&start={}&duration={}",
        urlencoding::encode(&query.file),
        urlencoding::encode(&quality),
        start,
        duration
    );

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
    Query(query): Query<TranscodeQuery>,
) -> Result<Response, StatusCode> {
    let full_path = state.base_video_path.join(&query.file);
    if !full_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let quality = query.quality.clone().unwrap_or_else(|| "720p".to_string());
    let start_sec = query.start.unwrap_or(0.0);

    // 1. ลองส่งงานไปให้เครื่อง Pentium Gold QSV Worker (192.168.1.40:4105) ก่อน
    let worker_url = format!(
        "http://192.168.1.40:4105/transcode?file={}&quality={}&start={}",
        urlencoding::encode(&query.file),
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

    // 2. ถ้าเครื่อง Pentium Gold ปิดอยู่ หรือติดต่อไม่ได้ ให้ใช้ CPU ในเครื่อง Xeon แปลงเป็น Fallback อัตโนมัติ
    let (scale, video_bitrate, audio_bitrate, crf) = match quality.as_str() {
        "480p" => ("scale=-2:480", "900k", "96k", "28"),
        "360p" => ("scale=-2:360", "500k", "64k", "30"),
        _ => ("scale=-2:720", "2200k", "128k", "25"), // 720p default
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
