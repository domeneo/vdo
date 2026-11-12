# คู่มือขั้นตอนการ Update / Build Frontend (Next.js) ให้ตรง 100% ไม่ติดแคชเก่า

ปัญหาที่พบบ่อยของ Next.js คือตัว Server มักจะแคชไฟล์ใน `.next` หรือเบราว์เซอร์จำ JavaScript chunks ตัวเดิมไว้ ทำให้โค้ดที่แก้ไปใหม่ไม่ยอมแสดงผล

---

## ⚡ วิธีแก้และอัปเดตโค้ดอย่างถูกต้อง (ทำตาม 3 ขั้นตอนนี้)

### ขั้นตอนที่ 1: สั่ง Rebuild แบบคลีนแคชบนเครื่อง Dev
(คำสั่งนี้จะลบโฟลเดอร์ `.next` เดิมทิ้งก่อน แล้ว Build ใหม่ทั้งหมดแบบสะอาด 100%)

เปิด PowerShell บนเครื่อง Dev แล้วรัน:
```powershell
cd d:\SourceCode\CODE\MyProject\vdo\frontend
# 1. ลบแคชเดิมทิ้ง
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue

# 2. Build โค้ดใหม่
npm run build

# 3. ซิงก์ไฟล์ขึ้น Server แบบ Mirror (ลบไฟล์เก่าบน Server ที่ไม่มีในเครื่องนี้ออกทั้งหมด)
robocopy "d:\SourceCode\CODE\MyProject\vdo\frontend\.next" "\\192.168.1.242\web\vdo\frontend\.next" /MIR /NFL /NDL /NJH /NJS /nc /ns /np
robocopy "d:\SourceCode\CODE\MyProject\vdo\frontend\src" "\\192.168.1.242\web\vdo\frontend\src" /MIR /NFL /NDL /NJH /NJS /nc /ns /np
```

---

### ขั้นตอนที่ 2: สั่ง Restart Service บนเครื่อง Server
ไปที่โปรแกรม **Swan Service Manager** บนเครื่อง Server (`192.168.1.242`):
1. เลือก service: **`VDO-Frontend`**
2. กดปุ่ม **Stop** แล้วกด **Start** ใหม่ (หรือกด **Restart**)
   - *คำสั่ง Execution Command คือ:* `npm start`
   - *Port:* `4104`

---

### ขั้นตอนที่ 3: ล้างแคชในเบราว์เซอร์ (สำคัญมาก!)
เบราว์เซอร์ส่วนใหญ่จะแอบเซฟไฟล์ JavaScript Chunks เก่าไว้ในเครื่อง ทำให้หน้าเว็บยังยิงไปที่ URL เก่า

**วิธีบังคับให้ดึงไฟล์ใหม่:**
- **Chrome / Edge (PC):**
  1. กด **`F12`** เพื่อเปิดแถบ Developer Tools
  2. เลื่อนเมาส์ไปคลิกขวาที่ปุ่ม **Refresh (ปุ่มวงกลมรีโหลดข้างบน)**
  3. เลือกหัวข้อล่างสุด: **"ล้างแคชและฮาร์ดรีโหลด" (Empty Cache and Hard Reload)**
- **หรือทดสอบเปิดใน:** **หน้าต่างไม่ระบุตัวตน (Incognito / InPrivate Window)** โดยกด `Ctrl + Shift + N`

---

## 🌐 ตรวจสอบการเชื่อมต่อระบบทั้งหมด (Checklist)

| ระบบ | URL ทดสอบ | ผลลัพธ์ที่ถูกต้อง |
| :--- | :--- | :--- |
| **Rust Backend (Direct)** | `https://api-vdo.thaiswan.com/` | ขึ้นการ์ด **● Online & Ready (Rust Video Backend is Running!)** |
| **Rust API (FS)** | `https://api-vdo.thaiswan.com/api/fs` | ขึ้น `401 Unauthorized` (ถือว่าถูกต้อง เพราะต้องผ่านหน้าเว็บเพื่อส่ง Token) |
| **Next.js Web UI** | `https://vdo.thaiswan.com/` | แสดงหน้าล็อกอิน `dome` / `domeneo` และดึงข้อมูลวิดีโอจาก `api-vdo` |
