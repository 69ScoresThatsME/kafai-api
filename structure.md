# Kafai API Documentation

Base URL (production): `https://ชื่อโปรเจกต์ของคุณ.vercel.app/api`
Base URL (local dev): `http://localhost:3000/api`

ทุก response เป็น JSON. ทุก endpoint ที่ต้อง login จะต้องแนบ header:
```
Authorization: Bearer <token>
```

---

## 1. Auth

### 1.1 สมัครสมาชิก
```
POST /auth/register
```

**Body**
```json
{
  "username": "somchai",
  "password": "mypassword"
}
```

**Response 201 (สำเร็จ)**
```json
{
  "message": "สมัครสมาชิกสำเร็จ",
  "userId": "66b8f2a1c4e1a2b3d4e5f6a7"
}
```

**Response 400** — กรอกไม่ครบ
```json
{ "error": "กรุณากรอก username และ password" }
```

**Response 409** — username ซ้ำ
```json
{ "error": "username นี้ถูกใช้แล้ว" }
```

---

### 1.2 เข้าสู่ระบบ
```
POST /auth/login
```

**Body**
```json
{
  "username": "somchai",
  "password": "mypassword"
}
```

**Response 200 (สำเร็จ)**
```json
{
  "message": "เข้าสู่ระบบสำเร็จ",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
  "expiresIn": "30d"
}
```
> เก็บ `token` นี้ไว้ (เช่น localStorage หรือ cookie) แล้วแนบไปกับทุก request ที่เรียก `/kafai/*` — token จะหมดอายุใน 30 วันนับจากตอน login

**Response 401** — username/password ผิด
```json
{ "error": "username หรือ password ไม่ถูกต้อง" }
```

---

## 2. บันทึกค่าไฟ (kafai)

> ทุก endpoint ในหมวดนี้ต้องแนบ `Authorization: Bearer <token>` มิฉะนั้นจะได้ 401

โครงสร้างข้อมูล 1 รายการ (document):
| field | type | ความหมาย |
|---|---|---|
| `_id` | string | id ของรายการ |
| `userId` | string | id ของเจ้าของข้อมูล |
| `recordedAt` | date (ISO string) | วันที่บันทึกข้อมูลจริง |
| `targetDate` | date (ISO string) | วันที่ต้องการให้ข้อมูลนี้ผูกกับ (เช่น จดมิเตอร์วันที่ 1 แต่ผูกกับค่าของวันที่ 2) |
| `unit` | number | หน่วยไฟ (kWh) |
| `createdAt` / `updatedAt` | date | เวลาที่สร้าง/แก้ไข record (auto) |

---

### 2.1 เพิ่มข้อมูลค่าไฟ
```
POST /kafai
```

**Headers**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body**
```json
{
  "recordedAt": "2026-08-07",
  "targetDate": "2026-08-08",
  "unit": 123.5
}
```

**Response 201**
```json
{
  "_id": "66b90000c4e1a2b3d4e5f6a8",
  "userId": "66b8f2a1c4e1a2b3d4e5f6a7",
  "recordedAt": "2026-08-07T00:00:00.000Z",
  "targetDate": "2026-08-08T00:00:00.000Z",
  "unit": 123.5,
  "createdAt": "2026-08-07T07:10:00.000Z",
  "updatedAt": "2026-08-07T07:10:00.000Z"
}
```

**Response 400** — กรอกไม่ครบ
```json
{ "error": "ต้องระบุ recordedAt, targetDate, unit ให้ครบ" }
```

---

### 2.2 ดูรายการทั้งหมด (ของ user ที่ login อยู่)
```
GET /kafai
```
เรียงจาก `targetDate` ล่าสุดไปเก่าสุด

**Headers**
```
Authorization: Bearer <token>
```

**Response 200**
```json
[
  {
    "_id": "66b90000c4e1a2b3d4e5f6a8",
    "userId": "66b8f2a1c4e1a2b3d4e5f6a7",
    "recordedAt": "2026-08-07T00:00:00.000Z",
    "targetDate": "2026-08-08T00:00:00.000Z",
    "unit": 123.5,
    "createdAt": "2026-08-07T07:10:00.000Z",
    "updatedAt": "2026-08-07T07:10:00.000Z"
  }
]
```

---

### 2.3 ดูรายการเดียว
```
GET /kafai/:id
```

**Response 200** — เหมือน object เดี่ยวด้านบน

**Response 404**
```json
{ "error": "ไม่พบข้อมูล" }
```

---

### 2.4 แก้ไขรายการ
```
PUT /kafai/:id
```

**Headers**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body** (ส่งเฉพาะ field ที่จะแก้ก็ได้)
```json
{
  "unit": 130
}
```

**Response 200** — คืน object ที่อัปเดตแล้ว

**Response 404**
```json
{ "error": "ไม่พบข้อมูล" }
```

---

### 2.5 ลบรายการ
```
DELETE /kafai/:id
```

**Headers**
```
Authorization: Bearer <token>
```

**Response 200**
```json
{ "message": "ลบข้อมูลสำเร็จ" }
```

**Response 404**
```json
{ "error": "ไม่พบข้อมูล" }
```

---

## 3. Error ที่เจอได้บ่อย

| Status | ความหมาย |
|---|---|
| 400 | ข้อมูลที่ส่งมาไม่ครบ/ไม่ถูกต้อง |
| 401 | ไม่มี token / token หมดอายุ / login ผิด |
| 404 | ไม่พบข้อมูล / endpoint ไม่มีจริง |
| 409 | username ซ้ำ (ตอน register) |
| 500 | error ฝั่ง server เช่นต่อ DB ไม่ได้ |

---

## 4. ตัวอย่างเรียกจาก Frontend (fetch)

```js
const BASE_URL = "https://ชื่อโปรเจกต์ของคุณ.vercel.app/api";

// login
async function login(username, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (res.ok) {
    localStorage.setItem("token", data.token);
  }
  return data;
}

// เพิ่มค่าไฟ (ต้อง login ก่อน)
async function addKafai(recordedAt, targetDate, unit) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE_URL}/kafai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ recordedAt, targetDate, unit }),
  });
  return res.json();
}

// ดึงรายการทั้งหมด
async function getKafaiList() {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE_URL}/kafai`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}
```

> ถ้า response กลับมาเป็น 401 ที่หน้าไหนก็ตาม แปลว่า token หมดอายุ (เกิน 30 วัน) — ให้เด้งกลับไปหน้า login ใหม่