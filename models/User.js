const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    meterRevision: { type: Number, default: 0 },
    password: { type: String, required: true }, // เก็บเป็น hash เท่านั้น
  },
  { timestamps: true, collection: "Users" },
);

module.exports =
  mongoose.models.User || mongoose.model("User", userSchema, "Users");
