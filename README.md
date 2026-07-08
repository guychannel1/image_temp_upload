# 📂 Temp - Single-Page Portal + Admin Dashboard (SvelteKit + Supabase)

โปรเจกต์นี้ได้รับการพัฒนาขึ้นโดยใช้ SvelteKit (Svelte 5) ร่วมกับ Tailwind CSS v4 และการเชื่อมต่อฐานข้อมูลระดับเซิร์ฟเวอร์กับ Supabase (มีระบบ Mock DB ในตัวหากยังไม่ได้กำหนดคีย์) โดยยุบทุกหน้าจอให้ทำงานเป็น Single-page App (SPA) บนหน้า `/`

---

## ⚡ วิธีการรันระบบเพื่อทดสอบ (Development)

รันคำสั่งเหล่านี้เพื่อเปิดเว็บเซิร์ฟเวอร์แบบ Local:

```sh
# ติดตั้งและเปิดเซิร์ฟเวอร์พร้อมเปิดแท็บเบราว์เซอร์
npm run dev -- --open
```

---

## 🔌 การตั้งค่าเชื่อมต่อ Supabase (Database & Storage Setup)

หากคุณต้องการเปิดใช้ฐานข้อมูลและระบบจัดเก็บไฟล์รูปภาพจริงของ Supabase ให้ทำตามขั้นตอนดังนี้:

### ขั้นตอนที่ 1: สร้างไฟล์ `.env` ที่โฟลเดอร์นอกสุดของโปรเจกต์
สร้างไฟล์ชื่อ `.env` และกำหนดคีย์ของ Supabase:

```env
SUPABASE_URL="https://your-supabase-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-public-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-highly-recommended-for-storage-management"
```

*หมายเหตุ: หากในไฟล์ `.env` ไม่มีตัวแปรเหล่านี้ ระบบจะปรับเปลี่ยนโหมดการจัดเก็บเป็น **Mock DB** โดยทำงานในแรมของเครื่องจำลองโดยอัตโนมัติ ทำให้รันได้ทันทีโดยไม่พัง*

### ขั้นตอนที่ 2: รัน SQL Migration ใน Supabase
คัดลอกคำสั่ง SQL ด้านล่างนี้ไปวางใน **Supabase SQL Editor** ของโครงการคุณแล้วกดรัน (Run) เพื่อสร้างตารางข้อมูล:

```sql
-- 1. สร้างตาราง Collections สำหรับหัวข้อเปิดรับงาน
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. สร้างตาราง Submissions สำหรับรายละเอียดรูปภาพส่งงาน
CREATE TABLE submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    collection_name TEXT NOT NULL,
    name TEXT NOT NULL,
    group_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    original_size BIGINT NOT NULL,
    img_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### ขั้นตอนที่ 3: สร้าง Bucket ใน Supabase Storage
1. เปิดหน้า Supabase Dashboard ไปที่เมนู **Storage**
2. กดปุ่ม **New Bucket** ตั้งชื่อว่า `images`
3. **สำคัญ**: เปิดใช้งานเช็กบอกซ์ **Public bucket** (เพื่อให้ดึง URL รูปภาพไปแสดงและทำ ZIP โหลด JPEG ฝั่งผู้ใช้ได้)

---

## 🔐 ข้อมูลสิทธิ์การเข้าใช้งานหลังบ้าน
* ปุ่มเปลี่ยนโหมดจะอยู่ด้านขวาบนของ Header หน้าหลัก
* บัญชีผู้ดูแลหลังบ้าน:
  * **Username**: `admin`
  * **Password**: `1234`
  * คุ้กกี้เซสชัน: อยู่ได้นาน **1 วัน**
