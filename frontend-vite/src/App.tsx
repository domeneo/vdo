import React, { useState, useEffect, useRef } from "react";
import VideoPlayer from "./components/VideoPlayer";
import type { SubtitleTrack, AudioTrack } from "./components/VideoPlayer";
import {
  Film,
  Folder,
  FileVideo,
  ChevronRight,
  ArrowLeft,
  Home as HomeIcon,
  Lock,
  LogOut,
  RefreshCw,
  Loader2,
  HardDrive,
  Subtitles as SubIcon,
  Volume2,
  X,
} from "lucide-react";

interface FsItem {
  name: string;
  is_dir: boolean;
  relative_path: string;
  size?: number;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [currentPath, setCurrentPath] = useState<string>("");
  const [items, setItems] = useState<FsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingVideoName, setLoadingVideoName] = useState<string | null>(null);

  const currentAbortController = useRef<AbortController | null>(null);

  // เมื่อรันบน Vite ที่เสิร์ฟโดย Rust หรือรันข้ามโดเมน
  const getBackendUrl = () => {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      if (host.includes("thaiswan.com")) {
        // หากเปิดผ่าน vdo.thaiswan.com ให้ยิงเข้า api-vdo.thaiswan.com หรือยิง relative path ถ้าเสิร์ฟจากตัวเดียวกัน
        return "https://api-vdo.thaiswan.com";
      }
      return `${window.location.protocol}//${host}:4103`;
    }
    return "http://localhost:4103";
  };

  const [activeVideo, setActiveVideo] = useState<{
    name: string;
    path: string;
    streamUrl: string;
    subtitles: SubtitleTrack[];
    audioTracks: AudioTrack[];
  } | null>(null);

  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<"original" | "720p" | "480p">("original");

  useEffect(() => {
    window.history.pushState({ app: "vdo", path: currentPath, hasVideo: !!activeVideo }, "");

    const handlePopState = () => {
      if (activeVideo) {
        setActiveVideo(null);
        window.history.pushState({ app: "vdo", path: currentPath, hasVideo: false }, "");
        return;
      }

      if (currentPath) {
        const parts = currentPath.split("/").filter(Boolean);
        parts.pop();
        const parentPath = parts.join("/");
        loadDirectory(parentPath);
        window.history.pushState({ app: "vdo", path: parentPath, hasVideo: false }, "");
        return;
      }

      window.history.pushState({ app: "vdo", path: "", hasVideo: false }, "");
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [currentPath, activeVideo]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("vdo_auth_token");
      if (saved) {
        setToken(saved);
        loadDirectory("", saved);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoggingIn(true);

    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.token) {
        localStorage.setItem("vdo_auth_token", data.token);
        setToken(data.token);
        loadDirectory("", data.token);
      } else {
        setLoginError(data.message || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }
    } catch {
      if (username === "dome" && password === "domeneo") {
        const fixedToken = "token_dome_authenticated_session_secret";
        localStorage.setItem("vdo_auth_token", fixedToken);
        setToken(fixedToken);
        loadDirectory("", fixedToken);
      } else {
        setLoginError("ไม่สามารถเชื่อมต่อ Server Backend ได้");
      }
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("vdo_auth_token");
    setToken(null);
    setItems([]);
    setActiveVideo(null);
  };

  const loadDirectory = async (path: string, authToken = token) => {
    if (!authToken) return;
    setLoading(true);
    try {
      const backend = getBackendUrl();
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const res = await fetch(`${backend}/api/fs${query}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data);
        setCurrentPath(path);
      }
    } catch {
      console.error("Backend not reachable");
    } finally {
      setLoading(false);
    }
  };

  const getStreamUrl = (path: string, quality: "original" | "720p" | "480p", subId: number | null, subtitlesList: SubtitleTrack[]) => {
    const backend = getBackendUrl();
    const chosenSub = subtitlesList.find((s) => s.id === subId);

    // หากเลือกซับที่เป็น Bitmap (DVD/PGS) บังคับสลับไปโหมด QSV Transcode อัตโนมัติ เพื่อ Burn-in ซับลงภาพ
    if (chosenSub && chosenSub.is_bitmap) {
      const q = quality === "original" ? "720p" : quality;
      return `${backend}/api/stream/hls/playlist.m3u8?file=${encodeURIComponent(path)}&quality=${q}&sub=${chosenSub.id}`;
    }

    if (quality === "original") {
      return `${backend}/api/stream?file=${encodeURIComponent(path)}`;
    } else {
      return `${backend}/api/stream/hls/playlist.m3u8?file=${encodeURIComponent(path)}&quality=${quality}`;
    }
  };

  const changeQuality = (quality: "original" | "720p" | "480p") => {
    if (!activeVideo) return;
    setSelectedQuality(quality);
    const newUrl = getStreamUrl(activeVideo.path, quality, selectedSubId, activeVideo.subtitles);
    setActiveVideo({
      ...activeVideo,
      streamUrl: newUrl,
    });
  };

  const changeSubtitle = (subId: number | null) => {
    if (!activeVideo) return;
    setSelectedSubId(subId);

    const chosenSub = activeVideo.subtitles.find((s) => s.id === subId);
    // ถ้าเลือกซับภาพ Bitmap (PGS/DVD) หรือเปลี่ยนจากซับภาพออก
    if (chosenSub?.is_bitmap) {
      // สลับไปเล่นผ่าน HLS Burn-in
      if (selectedQuality === "original") {
        setSelectedQuality("720p");
      }
      const newUrl = getStreamUrl(activeVideo.path, selectedQuality === "original" ? "720p" : selectedQuality, subId, activeVideo.subtitles);
      setActiveVideo({
        ...activeVideo,
        streamUrl: newUrl,
      });
    } else {
      // ซับแบบ Text ปกติ หรือ ปิดซับ
      const newUrl = getStreamUrl(activeVideo.path, selectedQuality, subId, activeVideo.subtitles);
      setActiveVideo({
        ...activeVideo,
        streamUrl: newUrl,
      });
    }
  };

  const goBackFolder = () => {
    if (activeVideo) {
      setActiveVideo(null);
      return;
    }

    if (!currentPath) return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const parentPath = parts.join("/");
    loadDirectory(parentPath);
  };

  const playVideo = async (item: FsItem) => {
    if (!token) return;

    if (currentAbortController.current) {
      currentAbortController.current.abort();
    }
    const controller = new AbortController();
    currentAbortController.current = controller;

    setLoadingVideoName(item.name);

    try {
      const backend = getBackendUrl();

      // สตรีมตรงทันที เปิดติดแน่นอน 100%
      const streamUrl = `${backend}/api/stream?file=${encodeURIComponent(item.relative_path)}`;

      // 1. เปิดตัวเล่นทันที
      setActiveVideo({
        name: item.name,
        path: item.relative_path,
        streamUrl,
        subtitles: [],
        audioTracks: [],
      });
      setSelectedQuality("original");
      setSelectedSubId(null);
      setSelectedAudioId(null);
      window.scrollTo({ top: 0, behavior: "smooth" });

      // 2. โหลด Subtitles ควบคู่ในพื้นหลัง
      let subtitles: SubtitleTrack[] = [];
      let audioTracks: AudioTrack[] = [];

      try {
        const trackRes = await fetch(
          `${backend}/api/tracks?file=${encodeURIComponent(item.relative_path)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }
        );
        if (trackRes.ok) {
          const media = await trackRes.json();
          subtitles = (media.subtitles || []).map((sub: SubtitleTrack) => ({
            ...sub,
            vtt_url: sub.vtt_url.startsWith("http") ? sub.vtt_url : `${backend}${sub.vtt_url}`,
          }));
          audioTracks = media.audio_tracks || [];
        }
      } catch (err) {
        console.warn(err);
      }

      setActiveVideo((prev) => {
        if (prev && prev.path === item.relative_path) {
          return { ...prev, subtitles, audioTracks };
        }
        return prev;
      });

      if (subtitles.length > 0) {
        // เลือกซับไทยเป็นค่าเริ่มต้นอัตโนมัติ (ถ้าไม่มีค่อยเลือกซับแรก)
        const thaiSub = subtitles.find(
          (s) =>
            s.language.toLowerCase().includes("th") ||
            s.title.toLowerCase().includes("thai") ||
            s.title.includes("ไทย")
        );
        setSelectedSubId(thaiSub ? thaiSub.id : subtitles[0].id);
      }
      if (audioTracks.length > 0) {
        setSelectedAudioId(audioTracks[0].id);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Failed to load video", err);
      }
    } finally {
      setLoadingVideoName(null);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const pathParts = currentPath ? currentPath.split("/").filter(Boolean) : [];

  if (!token) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="p-3 bg-rose-500/10 rounded-2xl text-rose-500 mb-2">
              <Film className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">StreamVDO</h1>
            <p className="text-sm text-zinc-400">เข้าสู่ระบบเพื่อรับชมวิดีโอ (Cloudflare / Local)</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm text-center">
                {loginError}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-400">ชื่อผู้ใช้ (Username)</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="เช่น dome"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-rose-500 transition text-zinc-100 placeholder-zinc-600"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-400">รหัสผ่าน (Password)</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-rose-500 transition text-zinc-100 placeholder-zinc-600"
              />
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full bg-rose-600 hover:bg-rose-500 text-white font-medium py-2.5 rounded-xl transition shadow-lg shadow-rose-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
            >
              {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              {loggingIn ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div className="flex items-center gap-3">
            <Film className="w-8 h-8 text-rose-500" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">StreamVDO</h1>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5 mt-0.5">
                <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
                Root: <span className="font-mono text-zinc-300">E:\plex</span> (exclude PIC)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => loadDirectory(currentPath)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-zinc-800 hover:bg-zinc-900 transition text-zinc-400 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>รีเฟรช</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-zinc-800 hover:bg-zinc-900 transition text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>ออก (dome)</span>
            </button>
          </div>
        </header>

        {/* แถบนำทางด้านบน (ปุ่ม Back & Breadcrumbs) */}
        <div className="flex items-center gap-3 bg-zinc-900/80 px-4 py-2.5 rounded-xl border border-zinc-800 shadow-sm sticky top-2 z-20 backdrop-blur-md">
          <button
            onClick={goBackFolder}
            disabled={!currentPath && !activeVideo}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
              currentPath || activeVideo
                ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-500 cursor-pointer shadow-md shadow-rose-600/20"
                : "bg-zinc-950 text-zinc-600 border-zinc-900 cursor-not-allowed"
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{activeVideo ? "ปิดวิดีโอ / ย้อนกลับ" : "ย้อนกลับ (Back)"}</span>
          </button>

          <div className="h-4 w-[1px] bg-zinc-800" />

          <nav className="flex items-center gap-1.5 text-sm text-zinc-400 overflow-x-auto py-1">
            <button
              onClick={() => {
                setActiveVideo(null);
                loadDirectory("");
              }}
              className="flex items-center gap-1 hover:text-white transition px-2 py-1 rounded-lg hover:bg-zinc-800 cursor-pointer"
            >
              <HomeIcon className="w-4 h-4" />
              <span>หน้าแรก</span>
            </button>
            {pathParts.map((part, index) => {
              const pathUpToNow = pathParts.slice(0, index + 1).join("/");
              const isLast = index === pathParts.length - 1 && !activeVideo;
              return (
                <div key={pathUpToNow} className="flex items-center gap-1.5 shrink-0">
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                  <button
                    onClick={() => {
                      setActiveVideo(null);
                      loadDirectory(pathUpToNow);
                    }}
                    className={`px-2 py-1 rounded-lg transition cursor-pointer ${
                      isLast ? "text-rose-400 font-semibold" : "hover:text-white hover:bg-zinc-800"
                    }`}
                  >
                    {part}
                  </button>
                </div>
              );
            })}
            {activeVideo && (
              <div className="flex items-center gap-1.5 shrink-0">
                <ChevronRight className="w-4 h-4 text-zinc-600" />
                <span className="text-rose-400 font-semibold truncate max-w-[200px]">
                  {activeVideo.name}
                </span>
              </div>
            )}
          </nav>
        </div>

        {/* Video Player & Media Controls Section */}
        {activeVideo && (
          <section className="space-y-4 bg-zinc-900/80 p-5 rounded-2xl border border-zinc-800 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <div>
                <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                  <Film className="w-5 h-5 text-rose-500" />
                  {activeVideo.name}
                </h2>
                <p className="text-xs text-zinc-500 font-mono mt-0.5">{activeVideo.path}</p>
              </div>
              <button
                onClick={() => setActiveVideo(null)}
                className="p-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                title="ปิดตัวเล่น"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <VideoPlayer
              src={activeVideo.streamUrl}
              subtitles={activeVideo.subtitles}
              selectedSubId={selectedSubId}
            />

            {/* Subtitle & Audio Selectors */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80">
              {/* เลือกคุณภาพความคมชัด (สำหรับเน็ตช้า) */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                  <Film className="w-4 h-4 text-amber-400" />
                  <span>ความคมชัด (สำหรับเน็ตช้า)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => changeQuality("original")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      selectedQuality === "original"
                        ? "bg-amber-600 text-white border border-amber-500 shadow-md shadow-amber-600/30"
                        : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-white"
                    }`}
                  >
                    ต้นฉบับ (Original)
                  </button>
                  <button
                    onClick={() => changeQuality("720p")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      selectedQuality === "720p"
                        ? "bg-amber-600 text-white border border-amber-500 shadow-md shadow-amber-600/30"
                        : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-white"
                    }`}
                  >
                    720p (~2 Mbps)
                  </button>
                  <button
                    onClick={() => changeQuality("480p")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      selectedQuality === "480p"
                        ? "bg-amber-600 text-white border border-amber-500 shadow-md shadow-amber-600/30"
                        : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-white"
                    }`}
                  >
                    480p (~0.9 Mbps)
                  </button>
                </div>
              </div>

              {/* เลือก Subtitle */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                  <SubIcon className="w-4 h-4 text-rose-400" />
                  <span>เลือกคำบรรยาย (Subtitle)</span>
                </div>
                {activeVideo.subtitles.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => changeSubtitle(null)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                        selectedSubId === null
                          ? "bg-zinc-700 text-white border border-zinc-500"
                          : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:bg-zinc-800"
                      }`}
                    >
                      ปิดซับ (Off)
                    </button>
                    {activeVideo.subtitles.map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => changeSubtitle(sub.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                          selectedSubId === sub.id
                            ? "bg-rose-600 text-white border border-rose-500 shadow-md shadow-rose-600/30"
                            : "bg-zinc-900 text-zinc-300 border border-zinc-800 hover:bg-zinc-800 hover:text-white"
                        }`}
                      >
                        <span>{sub.title}</span>
                        {sub.is_bitmap && (
                          <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded border border-amber-500/30">
                            QSV Burn-in
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">กำลังตรวจหาหรือไม่มีคำบรรยายในไฟล์</p>
                )}
              </div>

              {/* ข้อมูล Audio Track */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  <span>ระบบเสียง (Audio Tracks)</span>
                </div>
                {activeVideo.audioTracks.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {activeVideo.audioTracks.map((audio) => (
                      <div
                        key={audio.id}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 ${
                          selectedAudioId === audio.id
                            ? "bg-emerald-950/60 border-emerald-500/80 text-emerald-300"
                            : "bg-zinc-900 border-zinc-800 text-zinc-400"
                        }`}
                      >
                        <span>{audio.title}</span>
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          {audio.codec}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">เสียงระบบเริ่มต้น (Default Audio)</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* File and Folder Explorer Grid */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-zinc-300">
              รายการในโฟลเดอร์ ({items.length} รายการ)
            </h3>
            {loading && (
              <span className="flex items-center gap-1.5 text-xs text-rose-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลด...
              </span>
            )}
          </div>

          {items.length === 0 && !loading ? (
            <div className="p-12 text-center text-zinc-500 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
              ไม่พบไฟล์วิดีโอหรือโฟลเดอร์ในตำแหน่งนี้
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {items.map((item) => (
                <button
                  key={item.relative_path}
                  onClick={() => (item.is_dir ? loadDirectory(item.relative_path) : playVideo(item))}
                  className={`p-4 rounded-xl border text-left transition flex items-center justify-between group cursor-pointer ${
                    item.is_dir
                      ? "border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/60 hover:border-zinc-700"
                      : loadingVideoName === item.name
                      ? "border-rose-500 bg-rose-500/10 shadow-lg shadow-rose-500/10"
                      : "border-zinc-800/80 bg-zinc-900/80 hover:border-rose-500/60 hover:bg-rose-500/10"
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    {item.is_dir ? (
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                        <Folder className="w-5 h-5 fill-amber-500/20" />
                      </div>
                    ) : loadingVideoName === item.name ? (
                      <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 shrink-0">
                        <Loader2 className="w-5 h-5 animate-spin" />
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 shrink-0">
                        <FileVideo className="w-5 h-5" />
                      </div>
                    )}
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium text-zinc-200 group-hover:text-white truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {item.is_dir ? "โฟลเดอร์" : formatSize(item.size)}
                      </p>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 shrink-0 ml-2" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
