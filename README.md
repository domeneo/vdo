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
2. **ปรับความคมชัดสำหรับเน็ตช้า (720p / 480p HLS Adaptive Streaming):**
   - มีปุ่มเลือกความคมชัด:
     - `ต้นฉบับ (Original)`
     - `720p (~2 Mbps)`
     - `480p (~0.9 Mbps)`
   - โยกภาระการบีบอัดไฟล์วิดีโอทั้งหมดไปให้ Intel UHD 710 บนเครื่องลูกข่าย ทำงานแบบฮาร์ดแวร์เร่งความเร็ว CPU เครื่องแม่คงที่ 0-1%
   - แสดงแถบเวลาความยาวเต็มเรื่อง (เช่น 1 ชั่วโมง 15 นาที) และสามารถคลิกเลื่อนข้ามเวลา (Seek) ไปช่วงเวลาใดก็ได้ ระบบจะตัดแปลงเฉพาะช่วงเวลานั้นทันที
3. **ระบบ Subtitle Ultra-Fast Extraction:**
   - ใช้ `ffprobe` ตรวจหาเฉพาะข้อมูลภาษาและชื่อซับไตเติล ส่งขึ้นหน้าเว็บทันทีใน 0.2 วินาที
   - ถอดซับทุกภาษาพร้อมกันในรอบเดียวในพื้นหลัง (Background Task)
   - เลือกภาษาไทยเป็นค่าเริ่มต้นอัตโนมัติ
4. **Mobile Native Experience:**
   - มีปุ่ม Back บนหน้าจอ และดักจับ Swipe/Back Button บน Android/iOS ไม่ให้เด้งหลุดออกจากเว็บ
5. **ระบบความปลอดภัย (Authentication):**
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

## 4. โครงสร้างและการจัดสรรพอร์ตในระบบ

| รายการ | IP Address | Port | โฟลเดอร์ / คำสั่งรัน | หน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **Media Server (Backend)** | `192.168.1.242` | `4103` | `E:\Web\vdo\backend\target\release\video_server.exe` | Axum API, Web UI SPA, Direct Stream |
| **Intel QSV Worker** | `192.168.1.40` | `4105` | `D:\transcode-worker\start_worker.bat` | Intel UHD 710 HLS Engine |
| **Network Share** | `192.168.1.242` | `445` (SMB) | `\\192.168.1.242\plex$\` | แชร์คลังหนัง Read-only ให้เครื่อง Worker |

---

## 5. การเปิดใช้งานและดูแลรักษาระบบ (Maintenance)

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
