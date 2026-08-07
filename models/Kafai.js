const mongoose = require('mongoose');

const kafaiSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // 1. วันที่บันทึกจริง (วันที่กดบันทึกข้อมูลนี้เข้าระบบ)
    recordedAt: { type: Date, required: true },

    // 2. วันที่ต้องการให้ข้อมูลนี้ผูกอยู่ (เช่น บันทึกวันที่ 1 แต่จดมิเตอร์เพื่อใช้กับวันที่ 2)
    targetDate: { type: Date, required: true },

    // 3. หน่วยไฟที่จดได้ (kWh)
    unit: { type: Number, required: true },
  },
  { timestamps: true, collection: 'kafai' }
);

kafaiSchema.index({ userId: 1, targetDate: 1 });

module.exports = mongoose.models.Kafai || mongoose.model('Kafai', kafaiSchema, 'kafai');
