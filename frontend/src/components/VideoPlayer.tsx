"use client";

import { useEffect, useRef } from "react";
import Hls from "hls.js";

export interface SubtitleTrack {
  id: number;
  title: string;
  language: string;
  vtt_url: string;
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

  // โหลดวิดีโอ
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (src.includes(".m3u8") && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      return () => {
        hls.destroy();
      };
    } else {
      video.src = src;
      video.load();
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
        className="w-full h-full object-contain"
        playsInline
        crossOrigin="anonymous"
      />
    </div>
  );
}
