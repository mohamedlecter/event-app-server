const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  location: {
    country: {
      type: String,
      required: true,
    },
    city: {
      type: String,
      required: true,
    },
  },
  standardTicket: {
    price: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    sold: {
      type: Number,
      default: 0,
    },
  },
  vipTicket: {
    price: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    sold: {
      type: Number,
      default: 0,
    },
  },
  date: {
    type: Date,
    required: true,
  },
  image: {
    type: String,
  },
  category: {
    type: String,
    required: true,
    enum: ["music", "sports", "art", "food", "business", "technology", "other"],
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  soldOut: {
    type: Boolean,
    default: false,
  },
});

// Check if event is sold out before saving
eventSchema.pre("save", function (next) {
  const standardSoldOut = this.standardTicket.sold >= this.standardTicket.quantity;
  const vipSoldOut = this.vipTicket.sold >= this.vipTicket.quantity;
  this.soldOut = standardSoldOut && vipSoldOut;
  next();
});

module.exports = mongoose.model("Event", eventSchema);