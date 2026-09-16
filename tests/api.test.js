const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Kafai = require("../models/Kafai");
const { migrationPlan, absolute } = require("../lib/meter");
let repl, app, owner, token, otherToken;
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  process.env.JWT_SECRET = "test-only-secret";
  await Kafai.init();
  owner = await User.create({ username: "test-owner", password: "test-only" });
  const other = await User.create({ username: "other", password: "test-only" });
  token = jwt.sign({ userId: owner.id }, process.env.JWT_SECRET);
  otherToken = jwt.sign({ userId: other.id }, process.env.JWT_SECRET);
  app = express();
  app.use(express.json());
  app.use("/api/kafai", require("../routes/kafai"));
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
const call = (method, path = "", auth = token) =>
  request(app)
    [method]("/api/kafai" + path)
    .set("Authorization", "Bearer " + auth)
    .set("X-Kafai-Version", "2");
test("CRUD, rollover, concurrency and ownership isolation", async () => {
  await Kafai.deleteMany({});
  let r = await call("post").send({
    recordedAt: "2026-09-01T00:00:00+07:00",
    meterReading: 9999,
  });
  assert.equal(r.status, 201, r.text);
  const a = r.body;
  r = await call("post").send({
    recordedAt: "2026-09-02T00:00:00+07:00",
    meterReading: 0,
    confirmRollover: true,
  });
  assert.equal(r.status, 201, r.text);
  const b = r.body;
  assert.equal(b.cycle, 1);
  assert.equal(absolute(b) - absolute(a), 1);
  assert.ok(!("targetDate" in b));
  const duplicate = await Promise.all([
    call("post").send({
      recordedAt: "2026-09-03T00:00:00+07:00",
      meterReading: 3,
    }),
    call("post").send({
      recordedAt: "2026-09-03T00:00:00+07:00",
      meterReading: 3,
    }),
  ]);
  assert.deepEqual(duplicate.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (await call("put", "/" + b._id, otherToken).send({ ...b, meterReading: 2 }))
      .status,
    404,
  );
  assert.equal(
    (await call("delete", "/" + b._id, otherToken).send(b)).status,
    404,
  );
  assert.equal((await call("get", "/" + b._id, otherToken)).status, 404);
  assert.equal(
    (
      await call("put", "/" + b._id).send({
        ...b,
        meterReading: 1,
        updatedAt: "stale",
      })
    ).status,
    409,
  );
  assert.equal(
    (await call("delete", "/" + b._id).send({ updatedAt: b.updatedAt })).status,
    200,
  );
  const list = (await call("get")).body;
  assert.equal(absolute(list[0]) - absolute(list[1]), 4);
  assert.equal(
    (
      await request(app)
        .put("/api/kafai/" + a._id)
        .set("Authorization", "Bearer " + token)
        .send({ unit: 20 })
    ).status,
    409,
  );
  for (const meterReading of [null, "", -1, 10000, "50"])
    assert.equal(
      (
        await call("post").send({
          recordedAt: "2026-09-04T00:00:00+07:00",
          meterReading,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await call("post").send({
        recordedAt: "2026-02-30T00:00:00Z",
        meterReading: 4,
      })
    ).status,
    400,
  );
  assert.equal((await call("get", "/bad-id")).status, 400);
});
test("migration dry run, archive, idempotence, rollback", async () => {
  await Kafai.deleteMany({});
  const docs = await Kafai.create([
    {
      userId: owner._id,
      recordedAt: new Date("2026-09-02T00:00:00Z"),
      unit: 10,
    },
    {
      userId: owner._id,
      recordedAt: new Date("2026-09-03T00:00:00Z"),
      unit: 23,
    },
  ]);
  const payload = {
    startAt: "2026-09-01T00:00:00Z",
    anchorAt: "2026-09-03T00:00:00Z",
    anchorReading: 2025,
    modulus: 10000,
    fingerprint: JSON.stringify(
      docs.map((r) => `${r.id}:${r.updatedAt.toISOString()}`).sort(),
    ),
  };
  const preview = await call("post", "/migration/preview").send(payload);
  assert.equal(preview.status, 200, preview.text);
  assert.deepEqual(
    preview.body.entries.map((r) => r.meterReading),
    [1992, 2002, 2025],
  );
  assert.equal(await Kafai.countDocuments(), 2);
  const commit = await call("post", "/migration/commit").send(payload);
  assert.equal(commit.status, 200, commit.text);
  assert.equal(await Kafai.countDocuments(), 3);
  assert.equal(
    (await call("post", "/migration/commit").send(payload)).status,
    409,
  );
  assert.equal(
    (
      await call("post", "/migration/rollback").send({
        migrationId: commit.body.migrationId,
      })
    ).status,
    200,
  );
  assert.equal(await Kafai.countDocuments(), 2);
});
test("usage-day reconstruction preserves corrected dates, missing spans and multiple wraps", () => {
  const records = [
    {
      _id: "a",
      recordedAt: new Date("2026-08-23Z"),
      targetDate: new Date("2026-08-22Z"),
      unit: 10000,
    },
    {
      _id: "b",
      recordedAt: new Date("2026-08-23Z"),
      targetDate: new Date("2026-08-22Z"),
      unit: 5,
    },
  ];
  const plan = migrationPlan(records, {
    mode: "usage_days",
    anchorAt: "2026-08-24T00:00:00+07:00",
    anchorReading: 3,
    dateCorrections: { b: "2026-08-23" },
  });
  assert.equal(plan.total, 10005);
  assert.equal(plan.entries[0].meterReading, 9998);
  assert.equal(
    absolute(plan.entries.at(-1)) - absolute(plan.entries[0]),
    10005,
  );
  assert.equal(plan.entries.length, 3);
  assert.equal(plan.gaps.length, 0);
});
