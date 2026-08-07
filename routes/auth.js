const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// สมัครสมาชิก
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอก username และ password' });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: 'username นี้ถูกใช้แล้ว' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });

    res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ', userId: user._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// เข้าสู่ระบบ -> ได้ token อายุ 30 วัน
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอก username และ password' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d', // token อยู่ได้ 1 เดือนต่อการ login 1 ครั้ง
    });

    res.json({ message: 'เข้าสู่ระบบสำเร็จ', token, expiresIn: '30d' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
