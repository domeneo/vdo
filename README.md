# คู่มือและสรุปสถาปัตยกรรมระบบเว็บสตรีมมิ่งดูหนัง (Production Ready)

ระบบเว็บดูหนังประสิทธิภาพสูงที่พัฒนาด้วย **Rust (Axum)** และ **Next.js 16** พร้อมรองรับการเชื่อมต่อผ่าน **Cloudflare Tunnel** และการใช้งานบนโทรศัพท์มือถืออย่างสมบูรณ์แบบ

---

## 1. ภาพรวมสถาปัตยกรรมและพอร์ตระบบ (System Architecture)

```
[ ผู้ใช้งานภายนอก ] ---> Cloudflare Tunnel (https://vdo.thaiswan.com)
                                 │
                                 ▼
                     [ Next.js Frontend : Port 4104 ]
                                 │
                     (คุยผ่าน https://api-vdo.thaiswan.com หรือ Local :4103)
                                 │
                                 ▼
                     [ Rust Backend (Axum) : Port 4103 ]
                                 │
             ┌───────────────────┴───────────────────┐
             ▼                                       ▼
  [ Video Root: E:\plex ]                 [ FFmpeg / FFprobe ]
  (คลังหนัง MKV, MP4, exclude PIC)        (ดึง Subtitle ภาษาไทย/อังกฤษ)
```

### การจัดสรรพอร์ตและโดเมน:
- **Frontend (Next.js):** พอร์ต `4104` 
  - URL ในบ้าน: `http://192.168.1.242:4104`
  - URL ภายนอก: `https://vdo.thaiswan.com/`
- **Backend (Rust API & Media Delivery):** พอร์ต `4103`
  - URL ในบ้าน: `http://192.168.1.242:4103`
  - URL ภายนอก: `https://api-vdo.thaiswan.com/` (เช็คสถานะได้ที่หน้าเว็บ มี Status Card บอกความพร้อม)

---

## 2. ฟังก์ชันเด่นที่สร้างขึ้นและเปิดใช้งานแล้ว

1. **Direct High-Performance Streaming:**
   - ใช้ `ServeFile` ของ Tower-HTTP สตรีมไฟล์จริงตรงจาก `E:\plex` รองรับ Range Requests
   - เปิดวิดีโอติดทันทีภายใน 1-2 วินาที ไม่ต้องรอแปลงไฟล์ล่วงหน้า ไม่กิน CPU ของเครื่อง Xeon E-2224
2. **ระบบ Subtitle Ultra-Fast Extraction (ถอดซับความเร็วสูง):**
   - **Instant Track List (0.2 วินาที):** ใช้ `ffprobe` ตรวจหาเฉพาะข้อมูลภาษาและชื่อซับไตเติล ส่งขึ้นหน้าเว็บทันที ผู้ใช้จะเห็นปุ่มเลือกซับและปุ่มเปิด/ปิดซับโผล่ขึ้นมาทันทีโดยไม่ต้องรอแปลง
   - **Single-Pass Multi-Output Background Extraction:** สั่ง FFmpeg ถอดซับทุกภาษาพร้อมกันในรอบเดียวในพื้นหลัง (Background Task) ช่วยลดเวลาแปลงลงจาก 30+ วินาที เหลือเพียงไม่กี่วินาที
   - **Smart Subtitle Streaming Endpoint (`/stream/subs/:hash/:filename`):** หากเบราว์เซอร์เรียกขอไฟล์ซับในขณะที่กำลังแปลง ระบบจะรอจนกว่าจะเขียนไฟล์เสร็จแล้วส่งไฟล์ทันที ไม่เกิดข้อผิดพลาด 404
   - **Auto Thai Priority:** เลือกระบบเสียงและซับไตเติลภาษาไทยเป็นค่าเริ่มต้นอัตโนมัติ (หากมีในไฟล์)
3. **ระบบ File Explorer ท่องโฟลเดอร์:**
   - นำทางแบบไดเรกทอรีชั้นต่อชั้น (เช่น `Serie` -> `Fallout SS1` -> รายการตอน)
   - กรองและตัดโฟลเดอร์ `PIC` รวมถึงโฟลเดอร์ระบบของ Windows ออกอัตโนมัติ
4. **Mobile Native Experience (รองรับมือถือ 100%):**
   - มีปุ่ม **"ย้อนกลับ (Back)"** ลอยติดขอบบนสุด (Sticky Top Bar)
   - **ดักจับปุ่ม Back บนโทรศัพท์มือถือ (Popstate Event):** เมื่อกดปุ่มย้อนกลับของมือถือ หรือสไลด์นิ้วย้อนกลับ ระบบจะ **ปิดวิดีโอ** หรือ **ถอยกลับโฟลเดอร์แม่** ทันที โดยไม่เด้งหลุดออกจากหน้าเว็บ
5. **ระบบความปลอดภัย (Authentication):**
   - ล็อกอินก่อนเข้าใช้งาน:
     - **Username:** `dome`
     - **Password:** `domeneo`

---

## 3. การตั้งค่าบนโปรแกรม Swan Service Manager (Server)

ในโปรแกรม Service Manager บนเครื่อง Server (`192.168.1.242`) ตั้งค่า 2 รายการดังนี้:

### Service 1: `VDO-Backend` (Rust)
- **Working Directory:** `E:\Web\vdo\backend`
- **Execution Command:** `target\release\video_server.exe` (หรือ `cargo run --release`)
- **Port:** `4103`
- **Auto-start:** ติ๊กถูก `[✓]`

### Service 2: `VDO-Frontend` (Next.js)
- **Working Directory:** `E:\Web\vdo\frontend`
- **Execution Command:** `npm start`
- **Port:** `4104`
- **Auto-start:** ติ๊กถูก `[✓]`

---

## 4. การตั้งค่า Cloudflare Tunnel (Zero Trust)

เพิ่ม Public Hostname ใน Tunnel ของโดเมน `thaiswan.com`:

| Subdomain | Domain | Service Type | URL ปลายทาง | คำอธิบาย |
| :--- | :--- | :--- | :--- | :--- |
| **`vdo`** | `thaiswan.com` | HTTP | `localhost:4104` | หน้าเว็บดูหนัง Next.js Web UI |
| **`api-vdo`** | `thaiswan.com` | HTTP | `localhost:4103` | Backend สตรีมวิดีโอความเร็วสูง |

---

## 5. วิธีการ Rebuild / อัปเดตโค้ดอย่างถูกต้อง (ป้องกันปัญหาแคชค้าง)

หากมีการแก้ไขโค้ด Frontend ในอนาคต ให้รันตามลำดับนี้เพื่อป้องกันเบราว์เซอร์จำ JavaScript Chunks เก่า:

```powershell
# 1. รันบนเครื่อง Dev (เพื่อ Build และ Mirror ขึ้น Server)
cd d:\SourceCode\CODE\MyProject\vdo\frontend
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
robocopy "d:\SourceCode\CODE\MyProject\vdo" "\\192.168.1.242\web\vdo" /E /XD node_modules target .git cache /NFL /NDL /NJH /NJS /nc /ns /np

# 2. บนเครื่อง Server (Swan Service Manager)
# กดปุ่ม Restart ที่ VDO-Frontend

# 3. บนเบราว์เซอร์ผู้ใช้
# กด Ctrl + F5 (Hard Reload) หรือเปิดในหน้าต่างไม่ระบุตัวตน (Incognito)
```
