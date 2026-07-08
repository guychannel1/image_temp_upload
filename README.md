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

---

## ☁️ การตั้งค่าระบบสำรองข้อมูลอัตโนมัติไปยัง Cloudflare R2 (Automatic Cloudflare R2 Backup)

โปรเจกต์นี้รองรับการสำรองข้อมูล (ตาราง/ความสัมพันธ์ของข้อมูล และไฟล์รูปภาพทั้งหมด) ไปยัง Cloudflare R2 โดยสามารถตั้งค่าตัวแปรสภาพแวดล้อมดังนี้:

### 1. กำหนดค่าในไฟล์ `.env`
ให้เพิ่มค่าด้านล่างนี้ในไฟล์ `.env` ของคุณ:

```env
CLOUDFLARE_R2_ACCESS_KEY_ID="your-r2-access-key-id"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
CLOUDFLARE_R2_ACCOUNT_ID="your-cloudflare-account-id"
CLOUDFLARE_R2_BUCKET_NAME="your-r2-bucket-name"
BACKUP_CRON_TOKEN="your-secure-backup-cron-token"
```

* **วิธีหาค่าต่าง ๆ บน Cloudflare**:
  1. เปิด **Cloudflare Dashboard** -> ไปที่เมนู **R2** -> กด **Create bucket** เพื่อสร้าง Bucket ใหม่สำหรับเก็บข้อมูลสำรอง
  2. ไปที่ **R2** -> คลิก **Manage R2 API Tokens** ด้านขวาของหน้าหลัก
  3. คลิก **Create API Token** -> เลือกสิทธิ์ของ Token เป็น **Edit** (หรือ Read/Write) -> คลิก **Create Token**
  4. คัดลอกค่า **Access Key ID**, **Secret Access Key** และ **Account ID** มาใส่ในไฟล์ `.env`

### 2. การสำรองข้อมูลด้วยตนเอง (Manual Backup)
ในหน้า Admin Dashboard ด้านหลังบ้าน จะมีปุ่ม **"แบ็กอัป R2"** ปรากฏอยู่ แอดมินสามารถกดปุ่มนี้เพื่อทำการดาวน์โหลดไฟล์และคัดลอกข้อมูลทั้งหมดจาก Supabase ขึ้น Cloudflare R2 ได้ทันที พร้อมการแจ้งเตือนแสดงความคืบหน้า

### 3. การสำรองข้อมูลอัตโนมัติ (Automatic Backup via Cron)
คุณสามารถตั้งค่าระบบส่งคำร้องขออัตโนมัติ (Cron Job) มายัง API endpoint เพื่อสั่งให้ระบบทำการสำรองข้อมูลเองเป็นรอบ ๆ ได้:

* **Endpoint**: `/api/backup?token=YOUR_BACKUP_CRON_TOKEN`
* **Method**: `GET` หรือ `POST`
* **ตัวอย่างคำสั่ง curl**:
  ```sh
  curl -X GET "https://your-website.com/api/backup?token=your-secure-backup-cron-token"
  ```
  *(คุณสามารถผูกบริการ Cron สำเร็จรูปภายนอก เช่น Cloudflare Workers Cron Triggers, cron-job.org หรือ GitHub Actions ได้ตามสะดวก)*

