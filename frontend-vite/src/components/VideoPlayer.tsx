import { useEffect, useRef } from "react";
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
}

export default function VideoPlayer({
  src,
  subtitles = [],
  selectedSubId,
  poster,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const savedTimeRef = useRef<number>(0);
  const isSwitchingSourceRef = useRef<boolean>(false);

  // จำตำแหน่งเวลาล่าสุดตลอดเวลาที่เล่น
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video && !isSwitchingSourceRef.current && video.currentTime > 0) {
      savedTimeRef.current = video.currentTime;
    }
  };

  // โหลดวิดีโอพร้อมจำตำแหน่งเดิมไว้เล่นต่ออัตโนมัติ
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // บันทึกเวลาปัจจุบันไว้ก่อนเปลี่ยน URL
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
        // ปลดล็อคสถานะการเปลี่ยน Source หลังจากข้ามเวลาแล้ว
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

  // สร้างและควบคุม Subtitle Tracks ด้วย dynamic track element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // เคลียร์ track เก่าที่อาจค้างอยู่ใน DOM
    const oldTracks = video.querySelectorAll("track");
    oldTracks.forEach((t) => t.remove());

    if (subtitles.length === 0) return;

    // สร้าง track elements ใหม่สำหรับทุก Subtitle
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

    // อัปเดต textTracks mode
    const applyTrackMode = () => {
      for (let i = 0; i < video.textTracks.length; i++) {
        const textTrack = video.textTracks[i];
        const targetSub = subtitles.find((s) => s.id === selectedSubId);
        if (targetSub && textTrack.label === targetSub.title) {
          textTrack.mode = "showing";
        } else {
          textTrack.mode = "disabled";
        }
      }
    };

    applyTrackMode();
    // เรียกซ้ำอีกครั้งเมื่อ tracks พร้อม
    video.textTracks.onchange = applyTrackMode;
  }, [subtitles, selectedSubId]);

  return (
    <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl border border-zinc-800">
      <video
        ref={videoRef}
        controls
        autoPlay
        poster={poster}
        onTimeUpdate={handleTimeUpdate}
        className="w-full h-full object-contain"
        playsInline
        crossOrigin="anonymous"
      />
    </div>
  );
}
