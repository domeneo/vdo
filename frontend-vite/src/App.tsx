import React, { useState, useEffect, useRef } from "react";
import VideoPlayer from "./components/VideoPlayer";
import type { SubtitleTrack, AudioTrack } from "./components/VideoPlayer";
import { AdminModal } from "./components/AdminModal";
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
  Shield,
  FolderPlus,
  Search,
} from "lucide-react";

interface FsItem {
  name: string;
  is_dir: boolean;
  relative_path: string;
  size?: number;
  is_additional?: boolean;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUsername, setCurrentUsername] = useState("");
  const [showAdminModal, setShowAdminModal] = useState(false);
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
  const [selectedQuality, setSelectedQuality] = useState<"original" | "1080p" | "720p" | "480p">("original");
  const [initialStartTime, setInitialStartTime] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // ฟังก์ชัน Sync URL ในเบราว์เซอร์ให้ตรงกับโฟลเดอร์หรือหนังที่เปิดอยู่ (เพื่อ Bookmark ได้)
  const updateUrlLocation = (dirPath: string, videoPath: string | null) => {
    const params = new URLSearchParams();
    if (dirPath) {
      params.set("path", dirPath);
    }
    if (videoPath) {
      params.set("watch", videoPath);
    }
    const query = params.toString();
    const newRelativeUrl = query ? `?${query}` : window.location.pathname;
    window.history.pushState({ app: "vdo", path: dirPath, watch: videoPath }, "", newRelativeUrl);
  };

  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const watchParam = urlParams.get("watch");
      const pathParam = urlParams.get("path") || "";

      if (watchParam) {
        if (!activeVideo || activeVideo.path !== watchParam) {
          const videoName = watchParam.split("/").pop() || watchParam;
          playVideo({ name: videoName, is_dir: false, relative_path: watchParam });
        }
      } else {
        if (activeVideo) {
          setActiveVideo(null);
        }
        if (currentPath !== pathParam) {
          loadDirectory(pathParam);
        }
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [activeVideo, currentPath, token]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("vdo_auth_token");
      const savedUser = localStorage.getItem("vdo_auth_user");
      const savedAdmin = localStorage.getItem("vdo_auth_admin") === "true";
      if (savedUser) setCurrentUsername(savedUser);
      setIsAdmin(savedAdmin);

      if (saved) {
        setToken(saved);
        // Also check whoami in background to verify session
        const backend = getBackendUrl();
        fetch(`${backend}/api/user/whoami`, { credentials: "include" })
          .then((r) => r.ok ? r.json() : null)
          .then((info) => {
            if (info) {
              setCurrentUsername(info.username);
              setIsAdmin(info.is_admin);
              localStorage.setItem("vdo_auth_user", info.username);
              localStorage.setItem("vdo_auth_admin", String(info.is_admin));
            }
          })
          .catch(() => {});

        // ตรวจสอบ Query parameters จาก URL ที่ Bookmark ไว้
        const urlParams = new URLSearchParams(window.location.search);
        const watchParam = urlParams.get("watch");
        const pathParam = urlParams.get("path") || "";

        loadDirectory(pathParam, saved);

        if (watchParam) {
          const videoName = watchParam.split("/").pop() || watchParam;
          playVideo({ name: videoName, is_dir: false, relative_path: watchParam }, saved, false);
        }
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
      // 1. Try SQLite User Login endpoint first
      let res = await fetch(`${backend}/api/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        const dummyToken = "sqlite_session_" + username;
        localStorage.setItem("vdo_auth_token", dummyToken);
        setToken(dummyToken);

        // Fetch whoami to know is_admin
        const whoRes = await fetch(`${backend}/api/user/whoami`, { credentials: "include" });
        if (whoRes.ok) {
          const who = await whoRes.json();
          setCurrentUsername(who.username);
          setIsAdmin(who.is_admin);
          localStorage.setItem("vdo_auth_user", who.username);
          localStorage.setItem("vdo_auth_admin", String(who.is_admin));
        }

        loadDirectory("", dummyToken);
        return;
      }

      // 2. Fallback to legacy fixed login (dome/domeneo)
      res = await fetch(`${backend}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.token) {
        localStorage.setItem("vdo_auth_token", data.token);
        localStorage.setItem("vdo_auth_user", username);
        localStorage.setItem("vdo_auth_admin", "true");
        setToken(data.token);
        setCurrentUsername(username);
        setIsAdmin(true);
        loadDirectory("", data.token);
      } else {
        setLoginError(data.message || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }
    } catch {
      if (username === "dome" && password === "domeneo") {
        const fixedToken = "token_dome_authenticated_session_secret";
        localStorage.setItem("vdo_auth_token", fixedToken);
        localStorage.setItem("vdo_auth_user", "dome");
        localStorage.setItem("vdo_auth_admin", "true");
        setToken(fixedToken);
        setCurrentUsername("dome");
        setIsAdmin(true);
        loadDirectory("", fixedToken);
      } else {
        setLoginError("ไม่สามารถเชื่อมต่อ Server Backend ได้");
      }
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      const backend = getBackendUrl();
      await fetch(`${backend}/api/user/logout`, { method: "POST", credentials: "include" });
    } catch {}
    localStorage.removeItem("vdo_auth_token");
    localStorage.removeItem("vdo_auth_user");
    localStorage.removeItem("vdo_auth_admin");
    setToken(null);
    setIsAdmin(false);
    setCurrentUsername("");
    setItems([]);
    setActiveVideo(null);
  };

  const loadDirectory = async (path: string, authToken = token, syncUrl = true) => {
    if (!authToken) return;
    setLoading(true);
    try {
      const backend = getBackendUrl();
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const res = await fetch(`${backend}/api/fs${query}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data);
        setCurrentPath(path);
        if (syncUrl) {
          updateUrlLocation(path, null);
        }
      }
    } catch {
      console.error("Backend not reachable");
    } finally {
      setLoading(false);
    }
  };

  const getStreamUrl = (
    path: string,
    quality: "original" | "1080p" | "720p" | "480p",
    subId: number | null,
    audioId: number | null,
    subtitlesList: SubtitleTrack[]
  ) => {
    const backend = getBackendUrl();
    const chosenSub = subtitlesList.find((s) => s.id === subId);
    const audioParam = audioId !== null ? `&audio=${audioId}` : "";

    // หากเลือกซับที่เป็น Bitmap (DVD/PGS) หรือเปลี่ยน Audio Track ที่ไม่ใช่แทร็กแรก บังคับสลับไปโหมด QSV Transcode
    const isFirstAudio = !activeVideo?.audioTracks || activeVideo.audioTracks.length === 0 || audioId === null || audioId === activeVideo.audioTracks[0].id;

    if (chosenSub && chosenSub.is_bitmap) {
      const q = quality === "original" ? "1080p" : quality;
      const subParam = `&sub=${chosenSub.id}`;
      return `${backend}/api/stream/hls/playlist.m3u8?file=${encodeURIComponent(path)}&quality=${q}${subParam}${audioParam}`;
    }

    // หากเลือก original หรือ 1080p โดยที่ใช้เสียงแทร็กแรก (และไม่มีซับ bitmap) สามารถ Direct Stream ได้ทันที
    if ((quality === "original" || quality === "1080p") && isFirstAudio) {
      return `${backend}/api/stream?file=${encodeURIComponent(path)}`;
    } else {
      const q = quality === "original" ? "1080p" : quality;
      return `${backend}/api/stream/hls/playlist.m3u8?file=${encodeURIComponent(path)}&quality=${q}${audioParam}`;
    }
  };

  const changeQuality = (quality: "original" | "1080p" | "720p" | "480p") => {
    if (!activeVideo) return;
    setSelectedQuality(quality);
    const newUrl = getStreamUrl(activeVideo.path, quality, selectedSubId, selectedAudioId, activeVideo.subtitles);
    setActiveVideo({
      ...activeVideo,
      streamUrl: newUrl,
    });
  };

  const changeSubtitle = (subId: number | null) => {
    if (!activeVideo) return;
    setSelectedSubId(subId);

    const chosenSub = activeVideo.subtitles.find((s) => s.id === subId);
    if (chosenSub?.is_bitmap) {
      if (selectedQuality === "original") {
        setSelectedQuality("1080p");
      }
      const newUrl = getStreamUrl(activeVideo.path, selectedQuality === "original" ? "1080p" : selectedQuality, subId, selectedAudioId, activeVideo.subtitles);
      setActiveVideo({
        ...activeVideo,
        streamUrl: newUrl,
      });
    } else {
      const newUrl = getStreamUrl(activeVideo.path, selectedQuality, subId, selectedAudioId, activeVideo.subtitles);
      setActiveVideo({
        ...activeVideo,
        streamUrl: newUrl,
      });
    }
  };

  const changeAudio = (audioId: number) => {
    if (!activeVideo) return;
    setSelectedAudioId(audioId);

    const isFirstAudio = activeVideo.audioTracks.length > 0 && activeVideo.audioTracks[0].id === audioId;
    let targetQuality = selectedQuality;
    if (!isFirstAudio && selectedQuality === "original") {
      targetQuality = "1080p";
      setSelectedQuality("1080p");
    }

    const newUrl = getStreamUrl(activeVideo.path, targetQuality, selectedSubId, audioId, activeVideo.subtitles);
    setActiveVideo({
      ...activeVideo,
      streamUrl: newUrl,
    });
  };

  const goBackFolder = () => {
    if (activeVideo) {
      setActiveVideo(null);
      updateUrlLocation(currentPath, null);
      return;
    }

    if (!currentPath) return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const parentPath = parts.join("/");
    loadDirectory(parentPath);
  };

  const playVideo = async (item: FsItem, authToken = token, syncUrl = true) => {
    const effectiveToken = authToken || token;
    if (!effectiveToken) return;

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

      // 1. ดึงตำแหน่งที่เคยเล่นค้างไว้จาก SQLite (playback progress)
      let savedStart = 0;
      try {
        const progRes = await fetch(
          `${backend}/api/video/progress?file=${encodeURIComponent(item.relative_path)}`,
          {
            headers: { Authorization: `Bearer ${effectiveToken}` },
            credentials: "include",
          }
        );
        if (progRes.ok) {
          const prog = await progRes.json();
          if (prog && typeof prog.start_time === "number" && prog.start_time > 0) {
            savedStart = prog.start_time;
          }
        }
      } catch (e) {
        console.warn("Could not load progress", e);
      }
      setInitialStartTime(savedStart);

      // 2. เปิดตัวเล่นทันที
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

      if (syncUrl) {
        updateUrlLocation(currentPath, item.relative_path);
      }

      // 2. โหลด Subtitles ควบคู่ในพื้นหลัง
      let subtitles: SubtitleTrack[] = [];
      let audioTracks: AudioTrack[] = [];

      try {
        const trackRes = await fetch(
          `${backend}/api/tracks?file=${encodeURIComponent(item.relative_path)}`,
          {
            headers: { Authorization: `Bearer ${effectiveToken}` },
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

      // หาค่า default subtitle & audio
      let defaultSubId: number | null = null;
      let defaultAudioId: number | null = null;

      if (subtitles.length > 0) {
        const thaiSub = subtitles.find(
          (s) =>
            s.language.toLowerCase().includes("th") ||
            s.title.toLowerCase().includes("thai") ||
            s.title.includes("ไทย")
        );
        defaultSubId = thaiSub ? thaiSub.id : subtitles[0].id;
        setSelectedSubId(defaultSubId);
      }

      if (audioTracks.length > 0) {
        defaultAudioId = audioTracks[0].id;
        setSelectedAudioId(defaultAudioId);
      }

      // ตรวจสอบว่าซับที่เลือกเป็น Bitmap หรือเสียงเริ่มต้นของไฟล์เบราว์เซอร์เล่นตรงไม่ได้หรือไม่
      // ถ้าซับเป็น Bitmap (PGS/DVD) อัปเกรด URL ไปเป็น HLS 1080p อัตโนมัติทันที
      const chosenSub = subtitles.find((s) => s.id === defaultSubId);
      let initialStreamUrl = streamUrl;

      if (chosenSub?.is_bitmap) {
        setSelectedQuality("1080p");
        const audioParam = defaultAudioId !== null ? `&audio=${defaultAudioId}` : "";
        initialStreamUrl = `${backend}/api/stream/hls/playlist.m3u8?file=${encodeURIComponent(item.relative_path)}&quality=1080p&sub=${chosenSub.id}${audioParam}`;
      }

      setActiveVideo((prev) => {
        if (prev && prev.path === item.relative_path) {
          return {
            ...prev,
            streamUrl: initialStreamUrl,
            subtitles,
            audioTracks,
          };
        }
        return prev;
      });
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

  const handleSaveProgress = async (currentTime: number) => {
    if (!activeVideo || currentTime <= 0) return;
    try {
      const backend = getBackendUrl();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      await fetch(`${backend}/api/video/progress`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          video_path: activeVideo.path,
          start_time: currentTime,
        }),
      });
    } catch (e) {
      console.warn("Failed to auto-save video progress", e);
    }
  };

  const pathParts = currentPath ? currentPath.split("/").filter(Boolean) : [];

  if (!token) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <img src="/cinema.png" alt="Cinema Logo" className="w-16 h-16 object-contain drop-shadow-md mb-2" />
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
                placeholder=""
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
            <img src="/cinema.png" alt="Cinema Logo" className="w-10 h-10 object-contain drop-shadow" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">StreamVDO</h1>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5 mt-0.5">
                <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
                Root: <span className="font-mono text-zinc-300">E:\plex</span> (exclude PIC)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isAdmin && (
              <button
                onClick={() => setShowAdminModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/30 transition cursor-pointer shadow-sm shadow-rose-600/10"
              >
                <Shield className="w-4 h-4" />
                <span>จัดการระบบ</span>
              </button>
            )}
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
              <span>ออก ({currentUsername || "ผู้ใช้"})</span>
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
                onClick={() => {
                  setActiveVideo(null);
                  updateUrlLocation(currentPath, null);
                }}
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
              initialStartTime={initialStartTime}
              onProgressUpdate={handleSaveProgress}
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
                    onClick={() => changeQuality("1080p")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      selectedQuality === "1080p"
                        ? "bg-amber-600 text-white border border-amber-500 shadow-md shadow-amber-600/30"
                        : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-white"
                    }`}
                  >
                    1080p (~5 Mbps)
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
                      <button
                        key={audio.id}
                        onClick={() => changeAudio(audio.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition cursor-pointer ${
                          selectedAudioId === audio.id
                            ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/30"
                            : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        }`}
                      >
                        <span>{audio.title}</span>
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/40 text-zinc-300">
                          {audio.codec}
                        </span>
                      </button>
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-zinc-300">
              รายการในโฟลเดอร์ ({items.length} รายการ)
            </h3>

            {/* Quick in-page Search Input */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="ค้นหาในหน้านี้..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-7 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-rose-500 w-48 sm:w-60 transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {loading && (
                <span className="flex items-center gap-1.5 text-xs text-rose-400 shrink-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> โหลด...
                </span>
              )}
            </div>
          </div>

          {items.length === 0 && !loading ? (
            <div className="p-12 text-center text-zinc-500 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
              ไม่พบไฟล์วิดีโอหรือโฟลเดอร์ในตำแหน่งนี้
            </div>
          ) : (
            <div className="space-y-6">
              {/* Primary Folders / Files */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {items
                  .filter((item) => !item.is_additional)
                  .filter((item) => !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((item) => (
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

              {/* Additional Folders Section (Placed at bottom with dividing line) */}
              {items.some((item) => item.is_additional) && (
                <div className="pt-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-[1px] flex-1 bg-zinc-800" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full">
                      <FolderPlus className="w-3.5 h-3.5 text-rose-500" />
                      โฟลเดอร์เพิ่มเติม / Network Share
                    </span>
                    <div className="h-[1px] flex-1 bg-zinc-800" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {items
                      .filter((item) => item.is_additional)
                      .filter((item) => !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map((item) => (
                        <button
                          key={item.relative_path}
                          onClick={() => loadDirectory(item.relative_path)}
                          className="p-4 rounded-xl border border-rose-950/40 bg-zinc-900/50 hover:bg-zinc-800/70 hover:border-rose-500/40 text-left transition flex items-center justify-between group cursor-pointer shadow-sm"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 shrink-0">
                              <FolderPlus className="w-5 h-5" />
                            </div>
                            <div className="overflow-hidden">
                              <p className="text-sm font-medium text-zinc-200 group-hover:text-white truncate">
                                {item.name}
                              </p>
                              <p className="text-xs text-rose-400/80 mt-0.5 flex items-center gap-1">
                                โฟลเดอร์เครือข่ายเพิ่มเติม
                              </p>
                            </div>
                          </div>

                          <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 shrink-0 ml-2" />
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Admin Panel Modal */}
      <AdminModal
        isOpen={showAdminModal}
        onClose={() => {
          setShowAdminModal(false);
          loadDirectory(currentPath);
        }}
        getBackendUrl={getBackendUrl}
      />
    </main>
  );
}
