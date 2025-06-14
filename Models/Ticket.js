const mongoose = require("mongoose");

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
  recipientInfo: {
    type: {
      type: String,
      enum: ['mobile', 'email'],
      required: true
    },
    value: {
      type: String,
      required: true
    },
    name: String
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
  reference: {
    type: String,
    required: true,
    unique: true,
  },
  paymentReference: {
    type: String,
    required: true,
  },
  qrCode: {
    data: String,
    generatedAt: Date
  },
  status: {
    type: String,
    enum: ["pending", "success", "failed"],
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
  transferHistory: [{
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    to: {
      type: {
        type: String,
        enum: ['mobile', 'email'],
      },
      value: String,
      name: String,
    },
    transferredAt: {
      type: Date,
      default: Date.now,
    }
  }]
});

module.exports = mongoose.model("Ticket", ticketSchema); 