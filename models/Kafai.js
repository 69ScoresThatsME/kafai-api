const mongoose = require("mongoose");
const finite = {
  validator: Number.isFinite,
  message: "ต้องเป็นตัวเลขที่มีค่าจำกัด",
};
const schema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recordedAt: { type: Date, required: true },
    recordType: {
      type: String,
      enum: ["meter_reading", "legacy_usage"],
      default: "legacy_usage",
    },
    schemaVersion: { type: Number, default: 2 },
    unit: { type: Number, min: 0, validate: finite },
    meterReading: { type: Number, min: 0, validate: finite },
    modulus: { type: Number, default: 10000, min: 1, validate: finite },
    cycle: { type: Number, default: 0, validate: Number.isSafeInteger },
    seriesId: { type: String, default: "main", maxlength: 100 },
    source: {
      type: String,
      enum: ["measured", "reconstructed"],
      default: "measured",
    },
    migrationId: mongoose.Schema.Types.ObjectId,
    sourceIds: [mongoose.Schema.Types.ObjectId],
  },
  { timestamps: true, collection: "kafai" },
);
schema.index({ userId: 1, recordedAt: 1 });
schema.index(
  { userId: 1, seriesId: 1, recordedAt: 1 },
  {
    unique: true,
    partialFilterExpression: { recordType: "meter_reading" },
  },
);
module.exports = mongoose.models.Kafai || mongoose.model("Kafai", schema);
