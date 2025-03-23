const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
  amount: { type: Number, required: true },
  reference: { type: String, required: true, unique: true },
  status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
  ticketType: { type: String, enum: ["standard", "vip"], required: true },
  quantity: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model("Payment", paymentSchema);