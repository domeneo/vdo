import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export interface SubtitleTrack {
  id: number;
  title: string;
  language: string;
  vtt_url: string;
  is_bitmap?: boolean;
}

export interface AudioTrack {
  id: number;
  title: string;
  language: string;
  codec: string;
}

interface VideoPlayerProps {
  src: string;
  subtitles?: SubtitleTrack[];
  selectedSubId?: number | null;
  poster?: string;
  initialStartTime?: number;
  onProgressUpdate?: (currentTime: number) => void;
}

export default function VideoPlayer({
  src,
  subtitles = [],
  selectedSubId,
  poster,
  initialStartTime = 0,
  onProgressUpdate,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const savedTimeRef = useRef<number>(initialStartTime);
  const lastSaveCallRef = useRef<number>(0);
  const isSwitchingSourceRef = useRef<boolean>(false);
  const [hideCursor, setHideCursor] = useState<boolean>(false);
  const hideTimerRef = useRef<any>(null);

  useEffect(() => {
    if (initialStartTime > 0 && savedTimeRef.current === 0) {
      savedTimeRef.current = initialStartTime;
      if (videoRef.current && videoRef.current.currentTime < 1) {
        videoRef.current.currentTime = initialStartTime;
      }
    }
  }, [initialStartTime]);

  const handleMouseMove = () => {
    setHideCursor(false);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }

    hideTimerRef.current = setTimeout(() => {
      if (document.fullscreenElement) {
        setHideCursor(true);
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    }, 2000);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setHideCursor(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  // Global Keyboard Shortcuts: Spacebar (Play/Pause), Left/Right (Seek +/- 5s), Up/Down (Volume)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ไม่ดักจับถ้าผู้ใช้กำลังพิมพ์อยู่ใน input, textarea หรือ element ที่กำลังพิมพ์
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        // หากมีปุ่ม Button โฟกัสอยู่ ให้ blur ออก เพื่อไม่ให้กด Space แล้วไปคลิกปุ่มนั้นซ้ำ
        if (activeEl instanceof HTMLElement && activeEl.tagName === "BUTTON") {
          activeEl.blur();
        }
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      } else if (e.code === "ArrowLeft" || e.key === "ArrowLeft") {
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (e.code === "ArrowRight" || e.key === "ArrowRight") {
        e.preventDefault();
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
      } else if (e.code === "ArrowUp" || e.key === "ArrowUp") {
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
      } else if (e.code === "ArrowDown" || e.key === "ArrowDown") {
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video && !isSwitchingSourceRef.current && video.currentTime > 0) {
      savedTimeRef.current = video.currentTime;

      const now = Date.now();
      if (now - lastSaveCallRef.current > 5000) {
        lastSaveCallRef.current = now;
        onProgressUpdate?.(video.currentTime);
      }
    }
  };

  const handlePauseOrEnded = () => {
    const video = videoRef.current;
    if (video && video.currentTime > 0) {
      onProgressUpdate?.(video.currentTime);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const resumeTime = savedTimeRef.current;
    isSwitchingSourceRef.current = true;

    if (src.includes(".m3u8") && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 90,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (resumeTime > 0) {
          video.currentTime = resumeTime;
        }
        video.play().catch(() => {});
        setTimeout(() => {
          isSwitchingSourceRef.current = false;
        }, 500);
      });

      return () => {
        hls.destroy();
      };
    } else {
      video.src = src;
      video.load();

      const onLoadedMetadata = () => {
        if (resumeTime > 0) {
          video.currentTime = resumeTime;
        }
        video.play().catch(() => {});
        setTimeout(() => {
          isSwitchingSourceRef.current = false;
        }, 500);
      };

      video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    }
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const oldTracks = video.querySelectorAll("track");
    oldTracks.forEach((t) => t.remove());

    if (subtitles.length === 0) return;

    subtitles.forEach((sub) => {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = sub.title;
      track.srclang = sub.language;
      track.src = sub.vtt_url;
      track.default = selectedSubId === sub.id;

      track.onload = () => {
        applyTrackMode();
      };

      video.appendChild(track);
    });

    const applyTrackMode = () => {
      if (!video.textTracks) return;
      for (let i = 0; i < video.textTracks.length; i++) {
        const textTrack = video.textTracks[i];
        const match = subtitles.find((s) => s.title === textTrack.label);
        if (match && selectedSubId === match.id) {
          textTrack.mode = "showing";
        } else {
          textTrack.mode = "disabled";
        }
      }
    };

    applyTrackMode();
  }, [subtitles, selectedSubId]);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className={`relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 ${
        hideCursor ? "cursor-none" : ""
      }`}
    >
      <video
        ref={videoRef}
        controls
        playsInline
        preload="auto"
        poster={poster}
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePauseOrEnded}
        onEnded={handlePauseOrEnded}
        className="w-full h-full object-contain"
      />
    </div>
  );
}