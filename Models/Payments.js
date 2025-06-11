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
  paymentGateway: {
    type: String,
    enum: ["stripe", "wave"],
    required: true,
  },
  waveSessionId: String,
  wavePaymentId: String,
  waveTransactionId: String,
  waveStatus: String,
  stripePaymentIntent: String,
  currency: {
    type: String,
    enum: ["USD", "XOF", "GMD", "EUR"],
    default: "GMD",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  lastStatusCheck: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model("Payment", paymentSchema);