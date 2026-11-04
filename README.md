# คู่มือและสรุปสถาปัตยกรรมระบบเว็บสตรีมมิ่งดูหนัง (Production Ready)

ระบบเว็บดูหนังประสิทธิภาพสูงที่พัฒนาด้วย **Rust (Axum)** + **Vite React SPA** พร้อมระบบกระจายโหลดการแปลงไฟล์วิดีโอระดับฮาร์ดแวร์ด้วย **Intel QuickSync Video (QSV)** และรองรับ **Cloudflare Tunnel** ใช้งานได้ราบรื่นทั้งคอมพิวเตอร์และมือถือ

---

## 1. ภาพรวมสถาปัตยกรรมเครือข่ายและระบบ (Multi-Node Architecture)

ระบบแบ่งออกเป็น 2 เครื่องเพื่อประสิทธิภาพสูงสุด:

```
[ ผู้ใช้งาน / มือถือ ] ---> Cloudflare Tunnel (https://vdo.thaiswan.com)
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ เครื่องแม่หลัก: Media Server (192.168.1.242, Xeon E-2224 4C/4T)        │
│                                                                        │
│  [ Rust Axum : Port 4103 ]                                             │
│    ├── ให้บริการ Frontend Single Page Application (Vite React dist/)   │
│    ├── API ตรวจสอบไฟล์, Subtitle Extraction (0.2s)                     │
│    ├── Direct Stream วิดีโอต้นฉบับตรงจาก E:\plex (Range Requests)       │
│    └── Reverse Proxy HLS ส่งต่อเน็ตช้าไปที่ Worker Machine             │
│                                                                        │
│  [ Shared Folder ]: \\192.168.1.242\plex$  (Read-only สำหรับคลังหนัง)   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Gigabit LAN)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ เครื่องลูกข่าย: Intel QSV Transcode Worker (192.168.1.40, Pentium Gold)│
│                                                                        │
│  [ Node.js Worker : Port 4105 ]                                        │
│    ├── การ์ดจอ Intel UHD Graphics 710 (QuickSync Hardware Acceleration)│
│    ├── ถอดรหัส & แปลงวิดีโอ 720p / 480p / 360p บนชิป GPU โดยตรง        │
│    └── เสิร์ฟ Dynamic VOD HLS Playlist + On-Demand MPEG-TS Segments    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. ฟังก์ชันเด่นของระบบ

1. **สตรีมตรงระดับความเร็วสูงสุด (Original Direct Streaming):**
   - สตรีมตรงจาก `E:\plex` ทันทีภายใน 1 วินาที ไม่กิน CPU ของเครื่องแม่ Xeon
2. **ปรับความคมชัดสำหรับเน็ตช้าและการแปลงตามบริบท (Adaptive QSV Transcoding):**
   - มีปุ่มเลือกความคมชัด:
     - `ต้นฉบับ (Original)`
     - `1080p (~5 Mbps)` *(Full HD คมชัดสูงสำหรับสลับแทร็กเสียง/ซับบลูเรย์)*
     - `720p (~2 Mbps)`
     - `480p (~0.9 Mbps)`
   - โยกภาระการบีบอัดไฟล์วิดีโอทั้งหมดไปให้ Intel UHD 710 บนเครื่องลูกข่าย ทำงานแบบฮาร์ดแวร์เร่งความเร็ว CPU เครื่องแม่คงที่ 0-1%
   - แสดงแถบเวลาความยาวเต็มเรื่อง และสามารถคลิกเลื่อนข้ามเวลา (Seek) ไปช่วงเวลาใดก็ได้ ระบบจะตัดแปลงเฉพาะช่วงเวลานั้นทันที
3. **ระบบสลับแทร็กเสียงสมบูรณ์แบบ (Audio Track Switching):**
   - ตรวจจับและดึงแทร็กเสียงทุกภาษา (เช่น Thai Master AC3, English DTS) ออกมาเป็นปุ่มให้เลือกได้ทันที
   - หากเล่นแบบต้นฉบับแล้วกดเปลี่ยนภาษาเสียง ระบบจะสลับไปที่ **1080p QSV อัตโนมัติ** ทำให้เบราว์เซอร์เล่นเสียงที่เลือกได้ทันทีโดยไม่เสียความคมชัด
4. **ระบบ Subtitle ครอบคลุมทั้ง Text (SRT) และ Bitmap (Blu-Ray PGS / DVD VobSub):**
   - **Text Subtitles:** แสดงผลเป็น WebVTT ทันทีโดยไม่ต้องแปลงวิดีโอ
   - **Bitmap Subtitles (PGS/DVD):** สลับเข้าโหมด **Hardware Burn-in** บน GPU ของ Worker อัตโนมัติ พร้อมเทคนิค Letterbox Padding ป้องกันซับตกขอบจอ
5. **จดจำตำแหน่งเวลาเล่นต่อเนื่อง (Seamless Resume Playback):**
   - เมื่อผู้ใช้สลับซับไตเติล, สลับภาษาเสียง หรือเปลี่ยนความละเอียด ระบบจะจดจำวินาทีล่าสุด (`currentTime`) แล้วเล่นต่อจากตำแหน่งเดิมทันที ไม่ต้องเริ่มดูใหม่จาก 0
6. **รองรับ Bookmark & Direct Link Sharing:**
   - URL ซิงก์โฟลเดอร์และชื่อไฟล์หนังแบบ Dynamic (`?path=...&watch=...`) สามารถก็อปลิงก์ไปแชร์ หรือ Bookmark เก็บไว้เปิดดูต่อได้ทันที
   - โหลดข้อมูล Track เสียงและซับขึ้นมาอัตโนมัติ 100% แม้เปิดผ่าน Bookmark ลิงก์ตรง
7. **Cinema Auto-Hide Controls & Cursor บน PC:**
   - เมื่อเปิด Fullscreen บนคอมพิวเตอร์ หากไม่ขยับเมาส์เกิน 2 วินาที ตัวชี้เมาส์และแถบควบคุมด้านล่างจะเฟดซ่อนไปเองอัตโนมัติ เพื่อประสบการณ์รับชมแบบโรงภาพยนตร์
8. **ระบบความปลอดภัย (Authentication):**
   - บัญชีใช้งาน: `dome` / `domeneo`

---

## 3. สรุปปัญหาทางเทคนิคและวิธีแก้ (Intel QSV + HLS Seeking Issue)

### อาการที่พบเดิม:
- กดเลือก `720p` แล้วเล่นได้ 2-3 วินาทีแล้วค้าง
- เมื่อเลื่อนแถบเวลา (Seek) ไปที่นาทีที่ 20+ วิดีโอนิ่งสนิท ไม่เล่นต่อ

### ต้นตอของปัญหา (Root Causes):
1. **D3D11VA Frame Context Conflict:** คำสั่งเดิมใส่ `-hwaccel qsv` คู่กับตัวกรอง `vpp_qsv` ซึ่งบน Windows ส่งผลให้ DirectX Context ขัดข้องเมื่อสั่งตัดข้ามเวลา (Error: `Could not create the texture (80070057)` และ `Failed to configure output pad`) ทำให้ได้ไฟล์ segment ขนาด 0 ไบต์
2. **Cover Art Video Stream Interference:** ไฟล์หนัง MKV หลายเรื่องมีการฝังไฟล์รูปปก เช่น `Stream #0:9: Video: png, cover.png` ทำให้ FFmpeg พยายามดึงภาพปกมาเรนเดอร์แทนวิดีโอหลัก
3. **PTS / Keyframe Alignment:** การตัด segment ทีละ 4 วินาทีโดยไม่มี Keyframe บังคับทำให้ตัวเล่น HLS บนเบราว์เซอร์สะดุด

### วิธีแก้ไขที่เป็นผลสำเร็จ (Production Solution):
ใน `transcode-worker/worker.js` ปรับใช้สถาปัตยกรรม FFmpeg QSV ที่มีเสถียรภาพสูงสุด:
```javascript
const ffmpegArgs = [
  '-ss', start.toString(),
  '-i', inputPath,
  '-t', segDuration.toString(),
  '-map', '0:v:0',                        // เลือกเฉพาะสตรีมวิดีโอหลัก ตัดปัญหาติด cover.png
  '-map', '0:a:0?',                       // เลือกสตรีมเสียงหลัก
  '-vf', `scale=${targetWidth}:${targetHeight},format=nv12`, // แปลง Format เป็น NV12 ที่ QSV รองรับ 100%
  '-c:v', 'h264_qsv',                     // เข้ารหัสด้วย Intel QuickSync Hardware
  '-preset', 'veryfast',
  '-b:v', videoBitrate,
  '-maxrate', videoBitrate,
  '-c:a', 'aac',
  '-b:a', audioBitrate,
  '-ac', '2',
  '-f', 'mpegts',
  '-muxdelay', '0',
  'pipe:1'
];
```
> **ผลการทดสอบ:** สามารถแปลงไฟล์ได้ที่ความเร็ว **3.6x - 3.9x** (สตรีม 4 วินาทีใช้เวลาประมวลผลเพียง 1 วินาที) และเลื่อนแถบเวลาข้ามไปนาทีที่ 20 ได้อย่างต่อเนื่อง ราบรื่น

---

## 4. บันทึกประวัติการแก้ไขและฟังก์ชันที่พัฒนาสำเร็จ (Changelog & Technical Solutions)

### 1. ระบบเลือกและสลับระบบเสียง (Audio Track Switching)
- **ปัญหาเดิม:** เบราว์เซอร์ (Chrome / Edge / Safari) ไม่สามารถสลับแทร็กเสียงภาษาที่ 2 (เช่น เสียงไทย AC3/DTS) บนไฟล์ MKV แบบ Direct Stream ได้ด้วยตัวเอง ทำให้ฟังได้เฉพาะเสียงหลักภาษาอังกฤษเท่านั้น
- **วิธีแก้:**
  - เพิ่มการตรวจสอบและส่งพารามิเตอร์ `&audio={track_id}` จาก Frontend ไปยัง Rust Axum Backend (`/api/stream/hls/playlist.m3u8`) และส่งต่อไปยัง Node.js Worker (`192.168.1.40:4105`)
  - ใน Worker ทำการแมปเสียง `-map 0:${audio}` และเข้ารหัสเป็น AAC 2-channel ที่เบราว์เซอร์ทุกตัวรองรับ 100%
  - เพิ่ม preset **`1080p (~5 Mbps)`** เพื่อให้เวลาผู้ใช้กำลังดูโหมด "Original" แล้วกดสลับเสียง ระบบจะรักษาความคมชัดระดับ Full HD 1080p ไว้โดยไม่ลดทอนลงไปที่ 720p

### 2. ระบบซับไตเติลแบบภาพ (Blu-Ray PGS / DVD VobSub Burn-in with Letterbox Padding)
- **ปัญหาเดิม:** หนังที่เป็นซับแบบรูปภาพ (PGS Subtitle) ในหนังแผ่นบลูเรย์ความละเอียด 1920x800 เมื่อสั่ง burn-in ซับจะไม่แสดงผล เพราะขนาดแคนวาสของซับไตเติลถูกออกแบบมาที่ 1920x1080 (16:9) ทำให้ตำแหน่งซับตกลงไปอยู่นอกกรอบภาพ
- **วิธีแก้:**
  - ปรับปรุง Filter Complex ใน `worker.js`:
    ```javascript
    '-filter_complex',
    `[0:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v];[v][0:${sub}]overlay,scale=${targetWidth}:${targetHeight},format=nv12`
    ```
  - ทำการเติมแถบดำ (Padding) ให้ได้สัดส่วนมาตรฐาน 1920x1080 ก่อนทำการ Overlay ซับไตเติล แล้วจึงย่อขนาดลงตามความละเอียดเป้าหมาย ทำให้ซับไตเติล PGS และ DVD VobSub ทุกภาษาแสดงตรงตำแหน่ง สวยงาม คมชัด 100%

### 3. ระบบจดจำตำแหน่งเวลาเล่นต่อเนื่อง (Seamless Resume Playback)
- **ปัญหาเดิม:** เมื่อผู้ใช้เปลี่ยนความละเอียด หรือเปลี่ยนซับไตเติล/ระบบเสียง ตัวเล่นจะรีเซ็ตกลับไปเริ่มที่วินาทีที่ 0 ทำให้เสียอารมณ์ในการรับชม
- **วิธีแก้:**
  - ใน `VideoPlayer.tsx` เพิ่ม `savedTimeRef` เพื่อบันทึก `video.currentTime` ล่าสุดแบบ Realtime
  - เมื่อตรวจพบการเปลี่ยน URL ต้นทาง (`src`) ระบบจะส่งค่า `resumeTime` ไปรอไว้ และดักจับ Event `MANIFEST_PARSED` (สำหรับ HLS) หรือ `loadedmetadata` (สำหรับ Direct Stream) เพื่อสั่ง `video.currentTime = resumeTime` และสั่งเล่นต่อได้แบบไร้รอยต่อ

### 4. ซิงก์ URL และรองรับ Bookmark & Direct Link Sharing
- **ปัญหาเดิม:** URL บนเบราว์เซอร์นิ่งสนิท เมื่อผู้ใช้ Bookmark หรือส่งลิงก์ให้เพื่อนเปิด จะได้หน้าแรกสุด และถ้าเปิดผ่าน Bookmark บางครั้งแทร็กเสียง/ซับไม่ยอมโหลด
- **วิธีแก้:**
  - ใช้ `window.history.pushState` เพื่อซิงก์ Query Parameters `?path={folder}&watch={file}` แบบ Dynamic
  - ดักจับ Event `popstate` เพื่อให้การกดปุ่ม Back / Forward ของเบราว์เซอร์ทำงานได้เหมือน Native App
  - แก้ไขปัญหา Race Condition ของ Token ขณะโหลดหน้าผ่าน Bookmark ทำให้โหลดข้อมูล Subtitle และ Audio Tracks ขึ้นมาครบถ้วนทันที

### 5. Cinema Auto-Hide Controls & Mouse Cursor บน PC Fullscreen
- **ปัญหาเดิม:** เวลาเปิด Fullscreen บนคอมพิวเตอร์ แถบควบคุมด้านล่างไม่ยอมซ่อนตัว เนื่องจากเมาส์ค้างอยู่บนหน้าจอและปุ่มควบคุมยังค้าง Focus อยู่
- **วิธีแก้:**
  - ดักจับ Event `onMouseMove` ใน `VideoPlayer.tsx` เมื่อไม่มีการขยับเมาส์เกิน 2 วินาที ระบบจะสั่งใส่คลาส `cursor-none`
  - สั่ง `document.activeElement.blur()` อัตโนมัติ เพื่อปลด Focus ของเบราว์เซอร์ ทำให้เบราว์เซอร์พับเก็บแถบ Playback ด้านล่างลงทันทีแบบเดียวกับโรงภาพยนตร์

---

## 5. โครงสร้างและการจัดสรรพอร์ตในระบบ

| รายการ | IP Address | Port | โฟลเดอร์ / คำสั่งรัน | หน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **Media Server (Backend)** | `192.168.1.242` | `4103` | `E:\Web\vdo\backend\target\release\video_server.exe` | Axum API, Web UI SPA, Direct Stream |
| **Intel QSV Worker** | `192.168.1.40` | `4105` | `D:\transcode-worker\start_worker.bat` | Intel UHD 710 HLS Engine |
| **Network Share** | `192.168.1.242` | `445` (SMB) | `\\192.168.1.242\plex$\` | แชร์คลังหนัง Read-only ให้เครื่อง Worker |

---

## 6. การเปิดใช้งานและดูแลรักษาระบบ (Maintenance)

### คำสั่งสำหรับ Deploy อัปเดตระบบด้วยตนเอง (Deployment Guide):

ไฟล์สคริปต์หลัก: `deploy.ps1` (อยู่ที่รูทของโปรเจกต์ `d:\SourceCode\CODE\MyProject\vdo`)

เปิด **PowerShell** บนเครื่อง Dev แล้วใช้คำสั่งดังนี้:

#### 1. สั่ง Deploy อัตโนมัติทั้งหมด (Frontend + Worker):
```powershell
.\deploy.ps1
```
*(คำสั่งนี้จะ Build Vite Frontend แล้วซิงก์ไฟล์ `dist/` ขึ้น Server `192.168.1.242` และซิงก์ `worker.js` ไปยังเครื่อง GPU `192.168.1.40` ให้ครบจบในรอบเดียว)*

#### 2. เลือก Deploy เฉพาะส่วน:
- **Deploy เฉพาะหน้าเว็บ (Frontend UI):**
  ```powershell
  .\deploy.ps1 -FrontendOnly
  ```
- **Deploy เฉพาะ Rust Backend (Compile Release + สั่ง Restart Service บนเครื่อง 242 อัตโนมัติ):**
  ```powershell
  .\deploy.ps1 -BackendOnly
  ```
- **Deploy เฉพาะ Worker แปลงไฟล์ (ส่งไฟล์ไปยังเครื่อง 40):**
  ```powershell
  .\deploy.ps1 -WorkerOnly
  ```

---

#### 3. คำสั่ง Manual ทีละบรรทัด (กรณีต้องการรันเอง):

##### 🔹 Frontend (หน้าเว็บ Vite):
```powershell
cd d:\SourceCode\CODE\MyProject\vdo\frontend-vite
npm run build
robocopy "dist" "d:\SourceCode\CODE\MyProject\vdo\backend\dist" /E /NFL /NDL /NJH /NJS
robocopy "dist" "\\192.168.1.242\web\vdo\backend\dist" /E /NFL /NDL /NJH /NJS
```

##### 🔹 Rust Backend (Media Server 242):
```powershell
cd d:\SourceCode\CODE\MyProject\vdo\backend
cargo build --release
taskkill /s 192.168.1.242 /f /im video_server.exe
robocopy "target\release" "\\192.168.1.242\web\vdo\backend\target\release" video_server.exe /NFL /NDL /NJH /NJS
wmic /node:192.168.1.242 process call create "E:\Web\vdo\backend\target\release\video_server.exe"
```

##### 🔹 Worker (เครื่องถอดรหัส GPU 40):
```powershell
robocopy "d:\SourceCode\CODE\MyProject\vdo\transcode-worker" "\\192.168.1.40\d$\transcode-worker" worker.js /NFL /NDL /NJH /NJS
```

---

### การเริ่มทำงานของ Worker บนเครื่อง Intel (192.168.1.40):
1. ไปที่ `D:\transcode-worker`
2. ดับเบิ้ลคลิกไฟล์ `start_worker.bat`
3. จะขึ้นหน้าต่างคอนโซลสีเขียว แสดงสถานะ:
   ```
   Intel QSV HLS Engine is running on port 4105
   Video Source: \\192.168.1.242\plex$\
   Ready to serve fast hardware segments!
   ```

### การตั้งค่า Swan Service Manager บนเครื่องแม่ (192.168.1.242):
- **Service Name:** `VDO-Server`
- **Working Directory:** `E:\Web\vdo\backend`
- **Execution Command:** `target\release\video_server.exe`
- **Port:** `4103`
- **Auto-start:** `[✓]`
*(Frontend รวมอยู่ใน Single Binary แล้ว ไม่ต้องเปิดพอร์ต 4104 อีกต่อไป)*
