const express = require("express");
const cors = require("cors");
const connectDB = require("../config/db");
const authRoutes = require("../routes/auth");
const kafaiRoutes = require("../routes/kafai");
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const app = express();

// ถ้าตั้งค่า ALLOWED_ORIGIN ใน env จะจำกัดให้เฉพาะ origin นั้นเรียกได้
// ถ้าไม่ตั้ง จะเปิดรับทุก origin (*)
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  cors({
    origin: allowedOrigin || "*",
  }),
);
app.use(express.json());
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.get("/api/version", (req, res) =>
  res.json({ version: 2, readings: true, monthlyCost: true }),
);

// เชื่อมต่อ DB ก่อนทุก request (มี cache อยู่แล้วใน config/db.js)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res
      .status(500)
      .json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ", detail: err.message });
  }
});

app.get("/api", (req, res) => {
  res.json({ message: "Kafai API กำลังทำงานอยู่" });
});

app.use("/api/auth", authRoutes);
app.use("/api/kafai", kafaiRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: "ไม่พบ endpoint นี้" });
});

module.exports = app;
