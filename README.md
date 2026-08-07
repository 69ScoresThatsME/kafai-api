# Kafai API

ระบบบันทึกค่าไฟ (kafai) พร้อมระบบสมาชิก/login แบบ JWT (token อยู่ได้ 30 วันต่อการ login 1 ครั้ง) เขียนด้วย Express + MongoDB (Mongoose) พร้อม deploy ขึ้น Vercel

## ⚠️ สำคัญ: เรื่องความปลอดภัยของ Database ก่อนเริ่ม

คุณส่ง MongoDB connection string ที่มี username/password จริงมาในแชท ซึ่งถือว่า credential นี้รั่วไหลแล้ว แนะนำให้ทำตามนี้ก่อนใช้งานจริง:

1. เข้า MongoDB Atlas → Database Access → เปลี่ยน password ของ user `Relys` ทันที
2. ห้าม hardcode connection string ไว้ในโค้ดหรือ commit ขึ้น git — ให้ใส่ผ่าน environment variable เท่านั้น (ไฟล์นี้ตั้งค่าไว้ให้แล้วผ่าน `MONGODB_URI`)
3. ตั้งค่า Network Access ใน Atlas ให้จำกัด IP เท่าที่จำเป็น (หรือถ้าใช้ Vercel serverless ที่ IP ไม่คงที่ อาจต้องเปิด `0.0.0.0/0` แต่ให้พึ่ง strong password + IP restriction อื่นแทน)

## โครงสร้าง Database

Database ชื่อ `kafai`

- **Users** collection (U ใหญ่): `username`, `password` (hash แล้ว)
- **kafai** collection:
  - `userId` — อ้างอิงถึง user เจ้าของข้อมูล
  - `recordedAt` — วันที่บันทึกข้อมูลจริง (วันที่กดบันทึก)
  - `targetDate` — วันที่ต้องการให้ข้อมูลนี้ผูกอยู่ (เช่น จดมิเตอร์วันที่ 1 แต่ผูกกับค่าของวันที่ 2)
  - `unit` — หน่วยไฟ (kWh)

## การติดตั้งและรันในเครื่อง

```bash
npm install
cp .env.example .env
# แก้ .env ใส่ MONGODB_URI (password ใหม่ที่เปลี่ยนแล้ว) และ JWT_SECRET
npm run dev
```

เซิร์ฟเวอร์จะรันที่ `http://localhost:3000`

## API Endpoints

### สมัครสมาชิก
`POST /api/auth/register`
```json
{ "username": "somchai", "password": "mypassword" }
```

### เข้าสู่ระบบ (ได้ token อายุ 30 วัน)
`POST /api/auth/login`
```json
{ "username": "somchai", "password": "mypassword" }
```
Response:
```json
{ "message": "เข้าสู่ระบบสำเร็จ", "token": "xxxxx.yyyyy.zzzzz", "expiresIn": "30d" }
```

จากนั้นแนบ token ทุกครั้งที่เรียก endpoint ของ `/api/kafai` ผ่าน header:
```
Authorization: Bearer <token>
```

### บันทึกค่าไฟ
`POST /api/kafai`
```json
{
  "recordedAt": "2026-08-07",
  "targetDate": "2026-08-08",
  "unit": 123.5
}
```

### ดูรายการทั้งหมด
`GET /api/kafai`

### ดูรายการเดียว
`GET /api/kafai/:id`

### แก้ไขรายการ
`PUT /api/kafai/:id`
```json
{ "unit": 130 }
```

### ลบรายการ
`DELETE /api/kafai/:id`

## Deploy ขึ้น Vercel

1. Push โปรเจกต์นี้ขึ้น GitHub repo
2. ไปที่ [vercel.com](https://vercel.com) → New Project → เลือก repo นี้
3. ในหน้า Settings → Environment Variables ใส่:
   - `MONGODB_URI` = connection string จริง (password ที่เปลี่ยนใหม่แล้ว)
   - `JWT_SECRET` = ข้อความลับยาว ๆ สุ่ม ๆ
4. กด Deploy — Vercel จะอ่าน `vercel.json` แล้วรัน `api/index.js` เป็น serverless function ให้อัตโนมัติ
5. ทดสอบเรียก `https://<โปรเจกต์ของคุณ>.vercel.app/api`

หรือใช้ Vercel CLI:
```bash
npm i -g vercel
vercel
vercel env add MONGODB_URI
vercel env add JWT_SECRET
vercel --prod
```
