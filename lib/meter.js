const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const number = (value, name, min = 0) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min)
    fail(`${name} ต้องเป็นตัวเลขตั้งแต่ ${min}`);
  return value;
};
const date = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    fail("วันที่ต้องเป็น ISO timestamp พร้อม timezone");
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
    fail("วันที่ไม่ถูกต้อง");
  return new Date(value);
};
const round = (value) => Math.round(value * 1e6) / 1e6;
const absolute = (r) =>
  round(r.meterReading + (r.cycle || 0) * (r.modulus || 10000));
const mod = (v, m) => round(((v % m) + m) % m);
function reading(body, records, original) {
  const recordedAt = date(body.recordedAt);
  const meterReading = number(body.meterReading, "เลขมิเตอร์");
  const seriesId = body.seriesId ?? original?.seriesId ?? "main";
  if (typeof seriesId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(seriesId))
    fail("รอบมิเตอร์ไม่ถูกต้อง");
  if (original && seriesId !== original.seriesId)
    fail("ไม่สามารถย้ายรายการข้ามรอบได้");
  const peers = records
    .filter(
      (r) =>
        r.recordType === "meter_reading" &&
        r.seriesId === seriesId &&
        String(r._id) !== String(original?._id),
    )
    .sort((a, b) => +a.recordedAt - +b.recordedAt);
  if (peers.some((r) => +r.recordedAt === +recordedAt))
    fail("มีเลขมิเตอร์ ณ เวลานี้แล้ว กรุณาแก้รายการเดิม", 409);
  const prev = peers.filter((r) => +r.recordedAt < +recordedAt).at(-1);
  const next = peers.find((r) => +r.recordedAt > +recordedAt);
  const modulus = number(
    body.modulus ??
      original?.modulus ??
      prev?.modulus ??
      next?.modulus ??
      10000,
    "รอบหน้าปัด",
    1,
  );
  if (peers.some((r) => r.modulus !== modulus))
    fail("รอบหน้าปัดต้องตรงกันทั้งชุด");
  if (meterReading >= modulus) fail(`เลขหน้าปัดต้องน้อยกว่า ${modulus}`);
  const inferred = prev
    ? prev.cycle + (meterReading < prev.meterReading ? 1 : 0)
    : next
      ? next.cycle - (meterReading > next.meterReading ? 1 : 0)
      : 0;
  const cycle = body.cycle ?? original?.cycle ?? inferred;
  if (!Number.isSafeInteger(cycle)) fail("จำนวนรอบสะสมต้องเป็นจำนวนเต็ม");
  const entry = {
    recordedAt,
    meterReading,
    modulus,
    cycle,
    seriesId,
    recordType: "meter_reading",
    schemaVersion: 2,
    source: original?.source || "measured",
  };
  if (
    (prev && absolute(entry) < absolute(prev)) ||
    (next && absolute(entry) > absolute(next))
  )
    fail(
      "เลขสะสมรวมรอบไม่อยู่ระหว่างรายการก่อนและหลัง ตรวจเลขหรือจำนวนรอบ",
      409,
    );
  if (prev && cycle !== prev.cycle && body.confirmRollover !== true)
    fail("ตรวจสอบการวนมิเตอร์และยืนยันก่อนบันทึก", 409);
  const all = [
    ...records.filter(
      (r) =>
        r.recordType === "meter_reading" &&
        String(r._id) !== String(original?._id),
    ),
    entry,
  ].sort((a, b) => +a.recordedAt - +b.recordedAt);
  const spans = [],
    last = new Map();
  for (const r of all) {
    const p = last.get(r.seriesId);
    if (p)
      spans.push({
        start: +p.recordedAt,
        end: +r.recordedAt,
        series: r.seriesId,
      });
    last.set(r.seriesId, r);
  }
  if (
    spans.some((a, i) =>
      spans
        .slice(i + 1)
        .some(
          (b) => a.series !== b.series && a.start < b.end && b.start < a.end,
        ),
    )
  )
    fail("ช่วงของมิเตอร์สองชุดซ้อนกัน กรุณาตรวจวันเปลี่ยนมิเตอร์", 409);
  return entry;
}
function migrationPlan(records, body) {
  if (records.some((r) => r.recordType === "meter_reading"))
    fail("แปลงประวัติก่อนเริ่มจดเลขใหม่ หรือเก็บประวัติเดิมแยกชุดไว้", 409);
  const legacy = [...records].sort(
    (a, b) => +new Date(a.recordedAt) - +new Date(b.recordedAt),
  );
  if (!legacy.length) fail("ไม่มีข้อมูลเก่าให้แปลง", 409);
  if (body.mode === "usage_days") return usageDayPlan(legacy, body);
  const start = date(body.startAt);
  const anchorAt = date(body.anchorAt);
  const anchor = number(body.anchorReading, "เลขมิเตอร์อ้างอิง");
  const modulus = number(body.modulus ?? 10000, "รอบหน้าปัด", 1);
  if (anchor >= modulus) fail("เลขอ้างอิงเกินรอบหน้าปัด");
  if (+anchorAt !== +new Date(legacy.at(-1).recordedAt))
    fail(
      "เวลา anchor ต้องตรงปลายประวัติ หากมีช่วงขาดให้เก็บประวัติแยกและเริ่มมิเตอร์ใหม่",
    );
  if (+start >= +new Date(legacy[0].recordedAt))
    fail("เวลาตั้งต้นต้องอยู่ก่อนรายการแรก");
  let previous = +start;
  let total = 0;
  for (const r of legacy) {
    if (+new Date(r.recordedAt) <= previous)
      fail("ข้อมูลเก่ามีวันซ้ำหรือเวลาไม่ถูกต้อง กรุณาแก้ก่อนแปลง");
    total += number(r.unit, "หน่วยเก่า");
    previous = +new Date(r.recordedAt);
  }
  let accumulated = round(anchor - total);
  const make = (at, recordId) => ({
    ...(recordId ? { _id: recordId } : {}),
    recordedAt: new Date(at),
    meterReading: mod(accumulated, modulus),
    cycle: Math.floor(accumulated / modulus),
    modulus,
    seriesId: "main",
    recordType: "meter_reading",
    schemaVersion: 2,
    source: "reconstructed",
  });
  const entries = [make(start)];
  for (const r of legacy) {
    accumulated = round(accumulated + r.unit);
    entries.push(make(r.recordedAt, r._id));
  }
  return {
    entries,
    total: round(total),
    count: legacy.length,
    warning:
      "เลขย้อนหลังคำนวณจาก usage เดิม โดยวันบันทึกเป็นปลายช่วงและเวลาตั้งต้นเป็นเวลาที่คุณระบุ ไม่ใช่เลขที่วัดย้อนหลังจริง",
  };
}
function usageDayPlan(records, body) {
  const anchorAt = date(body.anchorAt),
    anchor = number(body.anchorReading, "เลขอ้างอิง"),
    modulus = number(body.modulus ?? 10000, "รอบหน้าปัด", 1);
  if (anchor >= modulus) fail("เลขอ้างอิงเกินรอบหน้าปัด");
  const corrections = body.dateCorrections || {};
  const grouped = new Map();
  for (const r of records) {
    const rawDay =
      corrections[String(r._id)] ||
      new Date(r.targetDate || r.recordedAt).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDay)) fail("วันที่แก้ไขไม่ถูกต้อง");
    const at = date(`${rawDay}T00:00:00+07:00`);
    const g = grouped.get(rawDay) || { at, total: 0, ids: [] };
    g.total += number(r.unit, "หน่วยเก่า");
    g.ids.push(r._id);
    grouped.set(rawDay, g);
  }
  const groups = [...grouped.values()].sort((a, b) => +a.at - +b.at);
  if (+anchorAt <= +groups.at(-1).at)
    fail("เวลาอ้างอิงต้องหลังวันใช้งานล่าสุด");
  const total = round(groups.reduce((s, g) => s + g.total, 0));
  let c = round(anchor - total);
  const entries = groups.map((g) => {
    const r = {
      _id: g.ids[0],
      sourceIds: g.ids,
      recordedAt: g.at,
      meterReading: mod(c, modulus),
      cycle: Math.floor(c / modulus),
      modulus,
      seriesId: "main",
      recordType: "meter_reading",
      schemaVersion: 2,
      source: "reconstructed",
    };
    c = round(c + g.total);
    return r;
  });
  entries.push({
    recordedAt: anchorAt,
    meterReading: anchor,
    cycle: 0,
    modulus,
    seriesId: "main",
    recordType: "meter_reading",
    schemaVersion: 2,
    source: "measured",
  });
  const gaps = groups
    .map((g, i) => ({
      from: g.at.toISOString(),
      to: (groups[i + 1]?.at || anchorAt).toISOString(),
      days: (+(groups[i + 1]?.at || anchorAt) - g.at) / 86400000,
    }))
    .filter((g) => g.days > 1.00001);
  if (gaps.length && body.acceptListedUsageTotal !== true)
    fail(
      "มีช่วงวันที่ขาด ต้องยืนยันสมมติฐานว่ายอดหน่วยที่ระบุครอบคลุมถึง anchor หรือเพิ่มข้อมูลช่วงขาดก่อน",
    );
  return {
    entries,
    total,
    count: records.length,
    gaps,
    warning:
      "ย้อนเลขจาก anchor ตามผลรวมหน่วยเดิม วันที่ใช้วันเป้าหมายเดิมที่แก้ไขแล้ว ช่วงวันที่ขาดถือเป็นช่วงรวมตามสมมติฐานที่ผู้ใช้ระบุ ไม่ใช่การวัดรายวันจริง",
  };
}
module.exports = { fail, number, date, absolute, reading, migrationPlan };
