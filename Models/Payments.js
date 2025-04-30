const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  reference: {
    type: String,
    required: true,
    unique: true,
  },
  tickets: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
    },
  ],
  status: {
    type: String,
    enum: ["pending", "success", "failed"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Payment", paymentSchema);