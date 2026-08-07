const mongoose = require('mongoose');

// ใช้ global cache กัน connection ใหม่ทุกครั้งที่ serverless function ถูกเรียก (สำคัญมากบน Vercel)
let cached = global._mongooseCache;
if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  let uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('ไม่พบ MONGODB_URI กรุณาตั้งค่า environment variable');
  }
  uri = uri.trim().replace(/^["']|["']$/g, '');

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        family: 4, // บังคับใช้ IPv4 กันปัญหา DNS SRV lookup ไม่ผ่านบน Vercel
      })
      .then((m) => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectDB;
