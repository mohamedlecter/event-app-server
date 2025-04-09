const mongoose = require("mongoose");
const transfer = require("paystack-api/resources/transfer");

const ticketSchema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  recipientEmail: {
    type: String,
  },
  ticketType: {
    type: String,
    enum: ["standard", "vip"],
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  reference: {  // Unique identifier for the ticket
    type: String,
    required: true,
    unique: true,
  },
  paymentReference: {  // Links to the parent payment
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "success", "failed",],
    default: "pending",
  },
  scanned: {
    type: Boolean,
    default: false,
  },
  scannedAt: {
    type: Date,
  },
  scannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  transferred: {
    type: Boolean,
    default: false,
  },

});

module.exports = mongoose.model("Ticket", ticketSchema);