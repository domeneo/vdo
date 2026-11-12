# Troubleshooting Playbook: Multi-Audio & Codec Direct Stream vs Transcode

บันทึกสรุปปัญหาและแนวทางการแก้ไขสำหรับระบบ Streaming Video (Rust + React Vite + Intel QSV Worker)

---

## 1. ปัญหา: เล่นที่ "ต้นฉบับ" หรือ "1080p" แล้วไม่มีเสียง (แต่ 720p / 480p มีเสียงปกติ)

### อาการ
- ไฟล์วิดีโอบางเรื่อง เช่น `Resident.Evil-2026.1080p.AMZN.WEB-DL.DUAL.DDP5.1.H.264-LOL.mkv`
- เมื่อเลือกดูแบบ **ต้นฉบับ (Original)** หรือ **1080p** พบว่า:
  - เสียงภาษาอังกฤษ **ไม่มีเสียง (เงียบสนิท)** แต่เล่นภาพได้ตามปกติ
  - เสียงภาษาไทย **มีเสียงปกติ**
- แต่เมื่อลดความละเอียดลงมาเป็น **720p** หรือ **480p** กลับ **มีเสียงภาษาอังกฤษตามปกติ**

### สาเหตุเชิงลึก
1. **ข้อจำกัดของ Web Browser ด้าน Audio Codec:**
   - เบราว์เซอร์ส่วนใหญ่ (Chrome, Edge, Firefox บน Windows) รองรับ Native Audio Decoding เฉพาะ **AAC, MP3, Opus, FLAC, Vorbis**
   - เบราว์เซอร์ไม่รองรับ **Dolby Digital Plus (E-AC-3 / DDP 5.1), Dolby TrueHD หรือ DTS** แบบ Native เมื่อเปิดไฟล์ดิบผ่าน HTML5 `<video>`
2. **กลไก Direct Stream เดิมใน Frontend:**
   - โค้ดเดิมกำหนดว่า ถ้าเลือก `1080p` หรือ `original` ร่วมกับแทร็กเสียงแรก (`isFirstAudio`) จะส่ง URL เป็น `/api/stream?file=...` (Direct Stream ไฟล์ดิบ)
   - ไฟล์หนังเรื่องนี้มีแทร็กเสียงภาษาอังกฤษเป็นแทร็กแรก และเข้ารหัสด้วย **E-AC-3 (DDP 5.1)** เบราว์เซอร์จึงถอดรหัสเสียงไม่ได้ ทำให้ไม่มีเสียง
   - ส่วนแทร็กเสียงภาษาไทยเป็นแทร็กที่ 2 ซึ่งไม่ใช่แทร็กแรก ระบบจึงส่งไป Transcode ที่ Worker `.40` อยู่แล้ว จึงมีเสียงปกติ
   - เมื่อเลือก 720p/480p ระบบส่งให้ Worker `.40` แปลงเป็น **AAC Stereo (`-c:a aac`)** เสมอ ทำให้เสียงอังกฤษดังได้ในความละเอียดเหล่านี้

### ทำไมถึงไม่ควรบังคับ 1080p ทั้งหมดไป Transcode?
- หากบังคับให้ 1080p ทุกไฟล์ต้องผ่าน Transcode Worker จะทำให้เครื่อง Worker รับโหลดหนัก, การ Seek ช้าลง, ต้องรอ Buffer HLS Segment, และกระทบไฟล์ส่วนใหญ่ที่เป็นเสียง AAC อยู่แล้ว

### วิธีแก้ไข (Selective Transcode by Audio Codec)
คงความสามารถ **Direct Stream** สำหรับ 1080p / Original ไว้เหมือนเดิม เพื่อประสิทธิภาพสูงสุด แต่เพิ่มเงื่อนไข **ตรวจเช็ค Codec เสียง** จาก Metadata ที่ได้จาก `/api/tracks`:

```typescript
// 1. รายชื่อ Codec เสียงที่ Web Browser เล่นตรงได้
const playableCodecs = ["aac", "mp3", "opus", "flac", "vorbis"];

// 2. ดึง Codec ของแทร็กเสียงที่เลือก
const tracks = audioTracksList || activeVideo?.audioTracks || [];
const currentAudioTrack = tracks.find((a) => a.id === audioId) || tracks[0];
const isAudioDirectPlayable = !currentAudioTrack || playableCodecs.includes(currentAudioTrack.codec.toLowerCase());

// 3. Direct Stream เฉพาะเมื่อ: แทร็กแรก + Codec ที่เบราว์เซอร์รองรับ
if ((quality === "original" || quality === "1080p") && isFirstAudio && isAudioDirectPlayable) {
  return `${backend}/api/stream?file=${encodeURIComponent(path)}`;
} else {
  // หากเป็น DDP, DTS, AC3 หรือเลือกแทร็กเสียงอื่น -> ส่งให้ Worker .40 แปลงเป็น AAC ทันที
  const q = quality === "original" ? "1080p" : quality;
  return `${backend}/api/stream/hls/playlist.m3u8?file=${encodeURIComponent(path)}&quality=${q}${audioParam}`;
}
```

---

## 2. ปัญหา: Worker Startup Script หา `worker.js` ไม่พบ (`MODULE_NOT_FOUND`)

### อาการ
เมื่อนำสคริปต์ `start_worker.bat` ไปใส่ใน `shell:startup` เพื่อให้รันตอนเปิดเครื่อง เกิด Error:
```text
Error: Cannot find module 'C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\worker.js'
```

### สาเหตุ
ในสคริปต์ `.bat` มีคำสั่ง `cd /d "%~dp0"` ซึ่ง `%~dp0` คือตำแหน่งของไฟล์ `.bat` เอง เมื่อนำไฟล์ตัวจริงไปวางไว้ที่โฟลเดอร์ Startup สคริปต์จะเปลี่ยน Working Directory ไปที่โฟลเดอร์ Startup นั้น ทำให้ Node หา `worker.js` ไม่เจอ

### วิธีแก้ไข
แก้ `cd` ในสคริปต์ให้ระบุตำแหน่ง Absolute Path ของโฟลเดอร์ Worker อย่างชัดเจน:
```cmd
cd /d "D:\transcode-worker"
node worker.js
```
*(หรือวางเป็น **Shortcut** ของไฟล์ `.bat` ลงใน `shell:startup` แทนการก๊อปปี้ไฟล์ `.bat` ไปวาง)*

---

## 3. ปัญหา: ใช้ Cloudflare Tunnel แล้วขึ้น "ไม่สามารถเชื่อมต่อ Server Backend ได้"

### อาการ
เมื่อชี้ Cloudflare Tunnel:
```yaml
- hostname: vdo.thaiswan.com
  service: http://localhost:4103
```
เปิดหน้าเว็บผ่าน `https://vdo.thaiswan.com` แล้วเว็บแจ้งเตือนว่าเชื่อมต่อ Backend ไม่ได้

### สาเหตุ
ในโค้ด Frontend มีการ hardcode ตรวจสอบ hostname ว่าถ้าเจอ `thaiswan.com` ให้ยิง API ไปที่ `https://api-vdo.thaiswan.com` ซึ่งไม่มีโดเมนหรือ Tunnel รองรับ

### วิธีแก้ไข
ในสถาปัตยกรรม Single-Port (Vite + Axum บนพอร์ต 4103 เดียวกัน) ให้ Frontend ชี้ไปที่ Origin เดียวกันกับที่กำลังเปิดหน้าเว็บอยู่เสมอ:
```typescript
const getBackendUrl = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:4103";
};
```

---

## 4. ปัญหา: ซับไตเติล Bitmap (PGS / DVDSub) ขาดหาย, ขึ้นช้า, หรือหายไปเองระหว่างเล่น

### อาการ
- เปิดดูหนังที่มีซับภาพ Bitmap เช่น PGS (`hdmv_pgs_subtitle`) หรือ DVD (`dvd_subtitle`)
- **อาการที่ 1:** ซับมีขึ้นไม่ทันบ้าง หรือประโยคที่พูดคาบรอยต่อ segment (6 วินาที) ขาดหายไป
- **อาการที่ 2:** เมื่อพยายามแก้ด้วย `-fix_sub_duration` หรือ `overlay=repeatlast=0` ซับกลับไม่ขึ้นเลย
- **อาการที่ 3:** เล่นไปสักพักซับหายไปเอง ต้องกดสลับแทร็กซับแล้วสลับกลับมาถึงจะดูได้อีกพักนึงแล้วก็หายไปอีก

### สาเหตุเชิงลึก
1. **ธรรมชาติของแพ็กเก็ตซับใน Matroska (.mkv):**
   - แพ็กเก็ตซับไตเติลจะถูกส่งมาเฉพาะ **"วินาทีแรกที่เริ่มประโยคพูด"** เท่านั้น
   - เมื่อระบบ HLS ตัดไฟล์เป็นท่อนละ 6 วินาที แล้วใช้ `-ss <start>` พุ่งตรงเข้าไปหาเวลาของ segment นั้นๆ หากประโยคพูดเริ่มพูดมาจาก 1-5 วินาทีก่อนหน้า (ใน segment ก่อน) การที่ FFmpeg กระโดดไปหา `start` จะทำให้ข้ามแพ็กเก็ตซับตัวนั้นไป
2. **ผลข้างเคียงของ `-fix_sub_duration`:**
   - คำสั่งนี้สั่งให้ FFmpeg "หยุดรอแพ็กเก็ตซับตัวถัดไป" ก่อนจึงจะส่งออก แต่ในคลิปสั้น 6 วินาทีไม่มีแพ็กเก็ตถัดไป FFmpeg จึงตัดจบ EOF และทิ้งข้อมูลซับไปทั้งหมด
3. **ผลข้างเคียงของ `repeatlast=0`:**
   - ซับ Bitmap ส่งข้อมูลมาแค่ 1 เฟรมที่จุดเริ่ม แล้วส่งเฟรมโปร่งใสเมื่อจบประโยค การใส่ `repeatlast=0` ทำให้ซับแสดงผลเพียง 1 เฟรม (1/24 วินาที) แล้วหายไปทันที
4. **Browser Disk Cache:**
   - การส่ง `Cache-Control: public, max-age=86400` ทำให้เบราว์เซอร์จำท่อน Segment เก่าที่เคยแปลงเสีย (ไม่มีซับ) ไว้ในดิสก์ เมื่อเล่นถึงช่วงเดิมเบราว์เซอร์จึงดึงไฟล์เก่าที่ไม่มีซับออกมาเล่น

### วิธีแก้ไขแบบบูรณาการ (ใน `worker.js`)
1. **ใช้ Subtitle Pre-roll (6.0 วินาที):**
   - สั่งให้ FFmpeg ถอยเวลากลับไป 6 วินาทีเต็ม เพื่อให้ Demuxer กวาดเอาแพ็กเก็ตซับที่เริ่มพูดค้างมาจากท่อนก่อนหน้า
   - แล้วใช้ Output Seek `-ss 6.0` ในการตัดส่วนที่ถอยไปอ่านออกที่ฝั่ง Encoder ทำให้ได้เวลาตรงเป๊ะ 100% และซับที่คาบรอยต่อไม่หลุดอีกเลย
2. **สเกล Canvas ซับให้เป็น 1920x1080 เสมอ:**
   - ซับ DVD/PGS บางแทร็กมาในขนาด 720p หรือ 480p ให้ผ่าน `[0:${sub}]scale=1920:1080[s]` ก่อน Overlay เพื่อให้ข้อความลงตำแหน่งล่างสุดคมชัดเสมอ
3. **เร่งความเร็วการย่อ 720p ด้วย `:flags=fast_bilinear`:**
   - ลดเวลาแปลง 720p ลง 3 เท่า (เหลือเพียง ~1.2 วินาทีต่อท่อน 6 วินาที) ลื่นไหล ไม่กระตุก
4. **ล้างแคชด้วย Cache-Busting (`&v=2`) และ `Cache-Control: no-cache`:**
   - ป้องกันเบราว์เซอร์ดึง Segment เก่าที่เสียออกมาแสดงซ้ำ

```javascript
const PRE_ROLL = (hasSub && start > 0) ? Math.min(6.0, start) : 0;
const seekStart = Math.max(0, start - PRE_ROLL);

let ffmpegArgs = [
  '-ss', seekStart.toString(),
  '-threads', '4',
  '-probesize', '15M',
  '-analyzeduration', '15M',
  '-i', inputPath,
];

if (hasSub) {
  ffmpegArgs.push(
    '-filter_complex',
    `[0:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v];[0:${sub}]scale=1920:1080[s];[v][s]overlay=eof_action=pass,scale=${targetWidth}:${targetHeight}:flags=fast_bilinear,format=nv12`
  );
}

if (PRE_ROLL > 0) {
  ffmpegArgs.push('-ss', PRE_ROLL.toString());
}
ffmpegArgs.push('-t', segDuration.toString(), ...);
```

---

## 5. การควบคุมเครื่องเล่นผ่านคีย์บอร์ด (Spacebar & Arrow Keys)

### อาการ
- เมื่อกดปุ่มเลือกเสียง, ซับ, หรือคุณภาพภาพ โฟกัสของเบราว์เซอร์จะไปอยู่ที่ปุ่ม (`<button>`)
- เมื่อกด Spacebar เบราว์เซอร์จะสั่งคลิกปุ่มเดิมซ้ำ หรือไม่หยุดเล่นวิดีโอ (โดยเฉพาะช่วงที่กำลังโหลด/บัฟเฟอร์)
- การกดเลื่อนซ้าย/ขวา ไม่ทำงานหากไม่ได้คลิกที่ตัววิดีโอโดยตรงก่อน

### วิธีแก้ไข (Global Keyboard Event Listener ใน `VideoPlayer.tsx`)
ดักจับ Event `keydown` ที่ระดับ `window` พร้อมตรวจสอบไม่ให้กวนการพิมพ์ใน Form ต่างๆ:
1. **Spacebar (`Space`):** สลับ Play / Pause พร้อมสั่ง `activeElement.blur()` ป้องกันการกดซ้ำที่ปุ่มก่อนหน้า
2. **ArrowLeft / ArrowRight:** กรอเดินหน้า / ถอยหลัง ครั้งละ 5 วินาที
3. **ArrowUp / ArrowDown:** ปรับระดับเสียงเพิ่ม/ลด ครั้งละ 10%

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
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
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);
```
