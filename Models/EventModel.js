const mongoose = require("mongoose");

const ticketTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    enum: ["USD", "XOF", "GMD", "EUR", "GBP"],
    default: "GMD"
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  sold: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    default: ""
  },
  benefits: [{
    type: String
  }]
});

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
  ticketTypes: {
    type: [ticketTypeSchema],
    required: true,
    validate: {
      validator: function(ticketTypes) {
        return ticketTypes && ticketTypes.length > 0;
      },
      message: 'At least one ticket type is required'
    }
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
  if (!this.ticketTypes || this.ticketTypes.length === 0) {
    this.soldOut = false;
    return next();
  }
  
  // Check if all ticket types are sold out
  const allSoldOut = this.ticketTypes.every(ticketType => 
    ticketType.sold >= ticketType.quantity
  );
  this.soldOut = allSoldOut;
  next();
});

// Add method to get available ticket types
eventSchema.methods.getAvailableTicketTypes = function() {
  return this.ticketTypes.filter(ticketType => 
    ticketType.sold < ticketType.quantity
  );
};

// Add method to check if a specific ticket type is available
eventSchema.methods.isTicketTypeAvailable = function(ticketTypeName) {
  const ticketType = this.ticketTypes.find(tt => tt.name === ticketTypeName);
  if (!ticketType) return false;
  return ticketType.sold < ticketType.quantity;
};

// Add method to get ticket type by name
eventSchema.methods.getTicketTypeByName = function(ticketTypeName) {
  return this.ticketTypes.find(tt => tt.name === ticketTypeName);
};

module.exports = mongoose.model("Event", eventSchema);