const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  photo: { type: String, required: true },
  isOnline: { type: Boolean, default: false },
  location: { type: String },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  duration: { type: Number },
  isFree: { type: Boolean, required: true, default: false },
  price: { type: Number, default: 0 },
  vipTicketPrice: { type: Number, default: 0 },
  category: { type: String, required: true },
  tags: [{ type: String }],
  capacity: { type: Number, default: 10 },
  standardTicketPrice: { type: Number, default: 100 },
  vipTicketPrice: { type: Number, default: 200 },
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  soldOut: { type: Boolean, default: false },
  url: { type: String },
  tickets: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      status: {
        type: String,
        enum: ["not-scanned", "scanned", "used", "cancelled"],
        default: "not-scanned",
      },
      scannedAt: Date,
      scannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
  ],
});

module.exports = mongoose.model("Event", eventSchema);
