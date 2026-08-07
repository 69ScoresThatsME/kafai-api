const express = require('express');
const Kafai = require('../models/Kafai');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ทุก route ในไฟล์นี้ต้อง login ก่อน (มี token)
router.use(authMiddleware);

// บันทึกค่าไฟใหม่
// body: { recordedAt, targetDate, unit }
router.post('/', async (req, res) => {
  try {
    const { recordedAt, targetDate, unit } = req.body;

    if (!recordedAt || !targetDate || unit === undefined) {
      return res.status(400).json({ error: 'ต้องระบุ recordedAt, targetDate, unit ให้ครบ' });
    }

    const entry = await Kafai.create({
      userId: req.userId,
      recordedAt: new Date(recordedAt),
      targetDate: new Date(targetDate),
      unit,
    });

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ดูรายการทั้งหมดของ user ที่ login อยู่ (เรียงตาม targetDate ล่าสุดก่อน)
router.get('/', async (req, res) => {
  try {
    const entries = await Kafai.find({ userId: req.userId }).sort({ targetDate: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ดูรายการเดียวจาก id
router.get('/:id', async (req, res) => {
  try {
    const entry = await Kafai.findOne({ _id: req.params.id, userId: req.userId });
    if (!entry) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// แก้ไขรายการ
router.put('/:id', async (req, res) => {
  try {
    const { recordedAt, targetDate, unit } = req.body;
    const update = {};
    if (recordedAt) update.recordedAt = new Date(recordedAt);
    if (targetDate) update.targetDate = new Date(targetDate);
    if (unit !== undefined) update.unit = unit;

    const entry = await Kafai.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      update,
      { new: true }
    );

    if (!entry) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ลบรายการ
router.delete('/:id', async (req, res) => {
  try {
    const entry = await Kafai.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!entry) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    res.json({ message: 'ลบข้อมูลสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
