const express = require("express");
const mongoose = require("mongoose");
const Kafai = require("../models/Kafai");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { fail, number, date, reading, migrationPlan } = require("../lib/meter");
const router = express.Router();
router.use(auth);
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status =
      err.status ||
      (err.code === 11000 ? 409 : err.name === "ValidationError" ? 400 : 500);
    res
      .status(status)
      .json({
        error:
          status === 500
            ? "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง (ฐานข้อมูลต้องรองรับ transactions)"
            : err.message,
      });
  }
};
const id = (value) => {
  if (!mongoose.isObjectIdOrHexString(value)) fail("รหัสรายการไม่ถูกต้อง");
  return new mongoose.Types.ObjectId(value);
};
const filter = (req) => ({ userId: id(req.userId) });
const modern = (req) => req.get("X-Kafai-Version") === "2";
const serialize = (r, v2) => {
  if (!v2) return { ...r, targetDate: r.targetDate || r.recordedAt };
  const { targetDate, ...rest } = r;
  return {
    ...rest,
    recordType: r.recordType || "legacy_usage",
    dateChanged:
      !!targetDate && +new Date(targetDate) !== +new Date(r.recordedAt),
  };
};
async function mutate(req, operation) {
  return mongoose.connection.transaction(async (session) => {
    // Serialize this user's mutations across all API instances, with transaction retries.
    const owner = await User.findOneAndUpdate(
      { _id: req.userId },
      { $inc: { meterRevision: 1 } },
      { new: true, session },
    );
    if (!owner) fail("ไม่พบบัญชี", 401);
    const records = await Kafai.collection
      .find(filter(req), { session })
      .toArray();
    return operation(session, records, owner.meterRevision);
  });
}
function assertModern(req, record) {
  if (!modern(req) && record.recordType === "meter_reading")
    fail("กรุณาอัปเดตแอปก่อนแก้เลขมิเตอร์", 409);
}
router.get(
  "/",
  wrap(async (req, res) => {
    const records = await Kafai.collection
      .find({
        ...filter(req),
        ...(!modern(req) ? { recordType: { $ne: "meter_reading" } } : {}),
      })
      .sort({ recordedAt: -1, _id: -1 })
      .toArray();
    res.json(records.map((r) => serialize(r, modern(req))));
  }),
);
router.post(
  "/migration/preview",
  wrap(async (req, res) => {
    const records = await Kafai.collection.find(filter(req)).toArray();
    res.json(migrationPlan(records, req.body));
  }),
);
router.post(
  "/migration/commit",
  wrap(async (req, res) => {
    const result = await mutate(req, async (session, records, revision) => {
      const plan = migrationPlan(records, req.body);
      if (
        JSON.stringify(
          records
            .map((r) => `${r._id}:${r.updatedAt?.toISOString() || ""}`)
            .sort(),
        ) !== req.body.fingerprint
      )
        fail("ประวัติเปลี่ยนแล้ว กรุณาดูตัวอย่างใหม่", 409);
      const migrationId = new mongoose.Types.ObjectId();
      await mongoose.connection
        .collection("kafai_migrations")
        .insertOne(
          {
            _id: migrationId,
            ...filter(req),
            records,
            revision,
            plan: req.body,
            gaps: plan.gaps || [],
            createdAt: new Date(),
            status: "applied",
          },
          { session },
        );
      await Kafai.deleteMany(filter(req), { session });
      await Kafai.insertMany(
        plan.entries.map((r) => ({ ...r, ...filter(req), migrationId })),
        { session },
      );
      return { migrationId, count: plan.count, total: plan.total };
    });
    res.json(result);
  }),
);
router.get(
  "/migration/latest",
  wrap(async (req, res) => {
    const m = await mongoose.connection
      .collection("kafai_migrations")
      .findOne(filter(req), {
        sort: { createdAt: -1 },
        projection: { records: 0 },
      });
    res.json(m);
  }),
);
router.post(
  "/migration/rollback",
  wrap(async (req, res) => {
    await mutate(req, async (session, records, revision) => {
      const collection = mongoose.connection.collection("kafai_migrations");
      const m = await collection.findOne(
        { _id: id(req.body.migrationId), ...filter(req), status: "applied" },
        { session },
      );
      if (!m) fail("ไม่พบการแปลงที่ย้อนกลับได้", 404);
      if (revision !== m.revision + 1)
        fail(
          "มีการแก้ข้อมูลหลังแปลงแล้ว ไม่ย้อนทับข้อมูลใหม่ กรุณาใช้สำเนาสำรองเพื่อกู้เฉพาะรายการ",
          409,
        );
      await Kafai.deleteMany(filter(req), { session });
      await Kafai.collection.insertMany(m.records, { session });
      await collection.updateOne(
        { _id: m._id, ...filter(req) },
        { $set: { status: "rolled_back" } },
        { session },
      );
    });
    res.json({ success: true });
  }),
);
router.post(
  "/",
  wrap(async (req, res) => {
    const result = await mutate(req, async (session, records) => {
      let data;
      if (modern(req)) data = reading(req.body, records);
      else
        data = {
          recordedAt: date(
            req.body.recordedAt?.length === 10
              ? `${req.body.recordedAt}T00:00:00+07:00`
              : req.body.recordedAt,
          ),
          unit: number(req.body.unit, "หน่วยไฟ"),
          recordType: "legacy_usage",
        };
      const [entry] = await Kafai.create([{ ...data, ...filter(req) }], {
        session,
      });
      return entry.toObject();
    });
    res.status(201).json(serialize(result, modern(req)));
  }),
);
router.get(
  "/:id",
  wrap(async (req, res) => {
    const record = await Kafai.collection.findOne({
      _id: id(req.params.id),
      ...filter(req),
    });
    if (!record) fail("ไม่พบรายการ", 404);
    assertModern(req, record);
    res.json(serialize(record, modern(req)));
  }),
);
router.put(
  "/:id",
  wrap(async (req, res) => {
    const recordId = id(req.params.id);
    const result = await mutate(req, async (session, records) => {
      const original = records.find((r) => r._id.equals(recordId));
      if (!original) fail("ไม่พบรายการ", 404);
      assertModern(req, original);
      if (
        modern(req) &&
        req.body.updatedAt !== original.updatedAt?.toISOString()
      )
        fail("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนแก้ไข", 409);
      const rawDate = req.body.recordedAt ?? original.recordedAt.toISOString();
      const data =
        original.recordType === "meter_reading"
          ? reading(req.body, records, original)
          : {
              recordedAt: date(
                rawDate.length === 10 ? `${rawDate}T00:00:00+07:00` : rawDate,
              ),
              unit: number(req.body.unit ?? original.unit, "หน่วยเก่า"),
            };
      return Kafai.findOneAndUpdate(
        { _id: recordId, ...filter(req) },
        { $set: data },
        { new: true, runValidators: true, session },
      ).lean();
    });
    res.json(serialize(result, modern(req)));
  }),
);
router.delete(
  "/:id",
  wrap(async (req, res) => {
    const recordId = id(req.params.id);
    await mutate(req, async (session, records) => {
      const original = records.find((r) => r._id.equals(recordId));
      if (!original) fail("ไม่พบรายการ", 404);
      assertModern(req, original);
      if (
        modern(req) &&
        req.body.updatedAt !== original.updatedAt?.toISOString()
      )
        fail("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่", 409);
      await Kafai.deleteOne({ _id: recordId, ...filter(req) }, { session });
    });
    res.json({ success: true });
  }),
);
module.exports = router;
