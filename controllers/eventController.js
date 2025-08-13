const Event = require("../Models/EventModel");
const Ticket = require("../Models/Ticket");
const Payment = require("../Models/Payments");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const paymentService = require("../services/paymentService");
const ticketService = require("../services/ticketService");
const notificationService = require("../services/notificationService");
const {createLogger, format, transports} = require("winston");

dotenv.config();


const logger = createLogger({
  level: "info",
  format: format.combine(
      format.timestamp(),
      format.json()
  ),
  transports: [
    new transports.File({ filename: "logs/payment-error.log", level: "error" }),
    new transports.File({ filename: "logs/payment.log" }),
    new transports.Console({
      format: format.combine(
          format.colorize(),
          format.simple()
      )
    })
  ]
});

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// Wave Configuration
const waveConfig = {
  apiKey: process.env.WAVE_API_KEY,
  apiUrl: "https://api.wave.com/v1",
};

// Create a new event (Admin only)
exports.createEvent = async (req, res) => {
  try {
    const {
      title,
      description,
      country,
      city,
      ticketTypes,
      date,
      category,
      image
    } = req.body;

    // Validate required fields
    if (!title || !country || !city || !ticketTypes || !date || !category) {
      return res.status(400).json({
        message: "Missing required fields",
        required: {
          title: "Event title",
          country: "Country",
          city: "City",
          ticketTypes: "Array of ticket types",
          date: "Event date",
          category: "Event category"
        }
      });
    }

    // Validate ticketTypes array
    if (!Array.isArray(ticketTypes) || ticketTypes.length === 0) {
      return res.status(400).json({
        message: "At least one ticket type is required"
      });
    }

    // Validate each ticket type
    for (let i = 0; i < ticketTypes.length; i++) {
      const ticketType = ticketTypes[i];
      if (!ticketType.name || !ticketType.price || !ticketType.quantity) {
        return res.status(400).json({
          message: `Ticket type ${i + 1} is missing required fields`,
          required: {
            name: "Ticket type name",
            price: "Ticket price",
            quantity: "Ticket quantity"
          }
        });
      }

      if (ticketType.price <= 0) {
        return res.status(400).json({
          message: `Price for ticket type "${ticketType.name}" must be greater than 0`
        });
      }

      if (ticketType.quantity <= 0) {
        return res.status(400).json({
          message: `Quantity for ticket type "${ticketType.name}" must be greater than 0`
        });
      }

      // Check for duplicate ticket type names
      const duplicateIndex = ticketTypes.findIndex((tt, index) => 
        index !== i && tt.name.toLowerCase() === ticketType.name.toLowerCase()
      );
      if (duplicateIndex !== -1) {
        return res.status(400).json({
          message: `Duplicate ticket type name: "${ticketType.name}"`
        });
      }
    }

    // Validate category
    const validCategories = ["music", "sports", "art", "food", "business", "technology", "other"];
    if (!validCategories.includes(category.toLowerCase())) {
      return res.status(400).json({
        message: "Invalid category",
        validCategories
      });
    }

    // Validate date
    const eventDate = new Date(date);
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({
        message: "Invalid date format"
      });
    }

    if (eventDate < new Date()) {
      return res.status(400).json({
        message: "Event date cannot be in the past"
      });
    }

    // Prepare ticket types with default values
    const preparedTicketTypes = ticketTypes.map(ticketType => ({
      name: ticketType.name.trim(),
      price: Number(ticketType.price),
      quantity: Number(ticketType.quantity),
      sold: 0,
      description: ticketType.description || "",
      benefits: ticketType.benefits || []
    }));

    const event = new Event({
      title,
      description,
      location: { 
        country, 
        city 
      },
      ticketTypes: preparedTicketTypes,
      date: eventDate,
      category: category.toLowerCase(),
      createdBy: req.user.id,
      image: req.file ? req.file.path : image || undefined,
      soldOut: false
    });

    await event.save();

    res.status(201).json({
      message: "Event created successfully",
      event
    });
  } catch (error) {
    console.error("Event Creation Error:", error);
    res.status(500).json({ 
      message: "Event creation failed", 
      error: error.message 
    });
  }
};

// Get all events with filtering
exports.getAllEvents = async (req, res) => {
  try {
    const { category, search, upcoming } = req.query;
    const query = {};

    if (category) query.category = category;
    if (search) query.title = { $regex: search, $options: "i" };
    if (upcoming === "true") query.date = { $gte: new Date() };

    const events = await Event.find(query).sort({ date: 1 });
    res.json(events);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch events", error: error.message });
  }
};


// get event tickets information
const getEventTicketsInfo = async (event) => {
  try {
    const tickets = await ticketService.getEventTickets(event._id);

    // Group tickets by type and count successful ones
    const ticketsByType = {};
    tickets.forEach(ticket => {
      if (ticket.status === 'success') {
        if (!ticketsByType[ticket.ticketType]) {
          ticketsByType[ticket.ticketType] = 0;
        }
        ticketsByType[ticket.ticketType]++;
      }
    });

    // Calculate availability for each ticket type
    const ticketTypesInfo = event.ticketTypes.map(ticketType => {
      const sold = ticketsByType[ticketType.name] || 0;
      const available = ticketType.quantity - sold;
      
      return {
        name: ticketType.name,
        price: ticketType.price,
        quantity: ticketType.quantity,
        sold: sold,
        available: available,
        description: ticketType.description,
        benefits: ticketType.benefits
      };
    });

    // Check if all ticket types are sold out
    const soldOut = ticketTypesInfo.every(type => type.available <= 0);

    return {
      ticketTypes: ticketTypesInfo,
      soldOut,
      totalTicketTypes: event.ticketTypes.length
    };
  } catch (err) {
    console.error("Error fetching event tickets:", err);
    return {
      ticketTypes: [],
      soldOut: false,
      totalTicketTypes: 0
    };
  }
}

// Get event details
exports.getEventDetails = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const eventInfo = await getEventTicketsInfo(event);

    res.json({
      event: event,
      info: eventInfo
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch event details", error: error.message });
  }
};

// Update event (Admin only)
exports.updateEvent = async (req, res) => {
  try {
    const event = await Event.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.json(event);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Event update failed", error: error.message });
  }
};

// Delete event (Admin only)
exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Event deletion failed", error: error.message });
  }
};

// Initiate Payment
exports.initiatePayment = async (req, res) => {
  let mainReference;

  try {
    const { eventId } = req.params;
    const {
      ticketTypeName,
      quantity,
      recipientType,
      recipientInfo,
      paymentGateway = "stripe",
      currency = "GMD",
      metadata
    } = req.body;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.soldOut) {
      return res.status(400).json({ message: "Event is sold out" });
    }

    // Find the requested ticket type
    const ticketType = event.getTicketTypeByName(ticketTypeName);
    if (!ticketType) {
      return res.status(400).json({ 
        message: "Invalid ticket type",
        availableTicketTypes: event.ticketTypes.map(tt => tt.name)
      });
    }

    // Check if ticket type is available
    if (!event.isTicketTypeAvailable(ticketTypeName)) {
      return res.status(400).json({ 
        message: `"${ticketTypeName}" tickets are sold out`,
        availableTicketTypes: event.getAvailableTicketTypes().map(tt => tt.name)
      });
    }

    // Check if enough tickets are available
    const availableTickets = ticketType.quantity - ticketType.sold;
    if (quantity > availableTickets) {
      return res.status(400).json({ 
        message: `Only ${availableTickets} "${ticketTypeName}" tickets available`,
        available: availableTickets,
        requested: quantity
      });
    }

    const amount = ticketType.price * quantity;
    mainReference = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create payment record
    const payment = await Payment.create({
      user: userId,
      event: eventId,
      amount,
      reference: mainReference,
      status: "pending",
      paymentGateway,
      currency,
    });

    // Create tickets with recipient information
    const { tickets: createdTickets, ticketReferences } = await ticketService.createTickets(
      eventId,
      userId,
      quantity,
      ticketTypeName,
      ticketType.price,
      mainReference,
      recipientInfo,
      recipientType
    );

    // Update payment with tickets
    payment.tickets = createdTickets;
    await payment.save();

    // Process payment based on selected gateway
    if (paymentGateway === "wave") {
      const waveSession = await paymentService.createWaveCheckout(
        amount,
        currency,
        mainReference,
        `${process.env.FRONTEND_URL}/payment-success?reference=${mainReference}`
      );

      return res.json({
        id: waveSession.id,
        paymentUrl: waveSession.payment_url || waveSession.url,
        gateway: "wave",
        reference: mainReference
      });
    } else {
      const session = await paymentService.createStripeSession(
        event,
        ticketTypeName,
        quantity,
        mainReference,
        ticketReferences,
        metadata
      );

      return res.json({ 
        id: session.id, 
        gateway: "stripe",
        reference: mainReference
      });
    }
  } catch (error) {
    console.error("Payment Initiation Error:", error);

    if (mainReference) {
      await Payment.deleteOne({ reference: mainReference }).catch(console.error);
      await Ticket.deleteMany({ paymentReference: mainReference }).catch(console.error);
    }

    res.status(500).json({
      message: "Payment initiation failed",
      error: error.message,
      details: error.response?.data || undefined,
    });
  }
};

// Verify Payment
exports.verifyPayment = async (req, res) => {
  try {
    const { reference, gateway } = req.body;

    if (!reference || !gateway) {
      return res.status(400).json({ 
        message: "Missing required parameters: reference and gateway" 
      });
    }

    let payment;
    let sessionData;

    if (gateway === "stripe") {
      const session = await stripe.checkout.sessions.retrieve(reference, {
        expand: ["payment_intent"],
      })
      const result = await paymentService.verifyStripePayment(session);
      payment = result.payment;
      sessionData = result.session;
    } else if (gateway === "wave") {
      const result = await paymentService.verifyWavePayment(reference);
      payment = result.payment;
      sessionData = result.waveData;

      // If payment is still pending, return appropriate message
      if (result.message) {
        return res.json({
          message: result.message,
          payment: result.payment,
          status: result.payment.status,
          waveData: result.waveData
        });
      }
    } else {
      return res.status(400).json({ message: "Invalid payment gateway" });
    }

    // Update payment status
    payment.status = "success";
    if (gateway === "stripe") {
      payment.stripePaymentIntent = sessionData.payment_intent.id;
    } else if (gateway === "wave") {
      // Update Wave-specific fields
      payment.wavePaymentId = sessionData.id;
      payment.waveTransactionId = sessionData.transaction_id;
      payment.waveStatus = sessionData.payment_status;
    }
    await payment.save();

    // Update tickets and generate QR codes
    const tickets = await Ticket.find({ paymentReference: payment.reference });
    for (const ticket of tickets) {
      ticket.status = "success";
      await ticket.save();
      
      // Generate QR code for each ticket
      await ticketService.generateTicketQR(ticket._id);
    }

    // Update event ticket counts for the specific ticket type
    const ticketTypeName = tickets[0].ticketType;
    const event = await Event.findById(payment.event);
    
    // Find the ticket type index and update the sold count
    const ticketTypeIndex = event.ticketTypes.findIndex(tt => tt.name === ticketTypeName);
    if (ticketTypeIndex !== -1) {
      event.ticketTypes[ticketTypeIndex].sold += tickets.length;
      await event.save();
    }

    // Check if event is sold out
    const updatedEvent = await Event.findById(payment.event);
    const allSoldOut = updatedEvent.ticketTypes.every(ticketType => 
      ticketType.sold >= ticketType.quantity
    );

    if (allSoldOut) {
      updatedEvent.soldOut = true;
      await updatedEvent.save();
    }


    // await Event.findByIdAndUpdate(payment.event, {
    //   $inc: { [`${ticketField}.sold`]: tickets.length },
    //   $set: {
    //     soldOut:
    //       event.standardTicket.sold +
    //         (ticketField === "standardTicket" ? tickets.length : 0) >=
    //         event.standardTicket.quantity &&
    //       event.vipTicket.sold +
    //         (ticketField === "vipTicket" ? tickets.length : 0) >=
    //         event.vipTicket.quantity,
    //   },
    // });

    // Send SMS notification for successful ticket purchase
    try {
      const ticketData = {
        eventTitle: event.title,
        eventDate: event.date,
        ticketType: ticketType,
        quantity: tickets.length,
        amount: payment.amount
      };
      
      await notificationService.sendTicketPurchaseSMS(payment.user, ticketData);
    } catch (smsError) {
      console.error("Failed to send purchase SMS notification:", smsError);
      // Don't fail the payment verification if SMS fails
    }

    const updatedPayment = await Payment.findById(payment._id)
      .populate("tickets")
      .populate("event")
      .populate("user", "name email");

    return res.json({
      message: `${gateway} payment verified successfully`,
      payment: updatedPayment,
      waveData: gateway === "wave" ? sessionData : undefined
    });
  } catch (error) {
    console.error("Payment Verification Error:", error);

    // Error handling and cleanup
    try {
      const reference = req.body.reference;
      if (reference) {
        await Payment.findOneAndUpdate(
          { reference },
          { $set: { status: "failed" } }
        );

        await Ticket.updateMany(
          { paymentReference: reference },
          { $set: { status: "failed" } }
        );
      }
    } catch (dbError) {
      console.error("Failed to update statuses on error:", dbError);
    }

    res.status(500).json({
      message: "Payment verification failed",
      error: error.message,
      details: error.response?.data || undefined,
    });
  }
};

// Get user's tickets
exports.getUserTickets = async (req, res) => {
  try {
    const tickets = await ticketService.getUserTickets(req.user.id);
    res.json(tickets);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch tickets", error: error.message });
  }
};

// Transfer ticket
exports.transferTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { recipientType, recipientValue, recipientName } = req.body;

    const result = await ticketService.transferTicket(ticketId, req.user.id, {
      recipientType,
      recipientValue,
      recipientName
    });

    // Send SMS notification to recipient
    try {
      await notificationService.sendTicketTransferSMS(ticketId, {
        recipientType,
        recipientValue,
        recipientName
      });
    } catch (smsError) {
      console.error("Failed to send transfer SMS notification:", smsError);
      // Don't fail the transfer if SMS fails
    }

    // Send SMS confirmation to original ticket owner
    try {
      const ticket = await Ticket.findById(ticketId).populate('event');
      const transferData = {
        recipientName,
        recipientValue,
        eventName: ticket.event.title,
        eventDate: ticket.event.date
      };
      
      await notificationService.sendTransferConfirmationSMS(req.user.id, transferData);
    } catch (smsError) {
      console.error("Failed to send transfer confirmation SMS:", smsError);
      // Don't fail the transfer if SMS fails
    }

    res.json({ 
      message: "Ticket transferred successfully", 
      ...result
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Ticket transfer failed", 
      error: error.message 
    });
  }
};

// Get transfer history
exports.getTransferHistory = async (req, res) => {
  try {
    const history = await ticketService.getTransferHistory(req.params.ticketId, req.user.id);
    res.json(history);
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to fetch transfer history", 
      error: error.message 
    });
  }
};

// Cancel transfer
exports.cancelTransfer = async (req, res) => {
  try {
    const ticket = await ticketService.cancelTransfer(req.params.ticketId, req.user.id);
    res.json({ 
      message: "Transfer cancelled successfully",
      ticket
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to cancel transfer", 
      error: error.message 
    });
  }
};

// Send transfer notification
exports.sendTransferNotification = async (req, res) => {
  try {
    const { ticketId, recipientType, recipientValue } = req.body;
    const notificationData = await notificationService.sendTransferNotification(ticketId, {
      recipientType,
      recipientValue
    });

    res.json({
      message: "Notification sent successfully",
      notificationData
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to send notification", 
      error: error.message 
    });
  }
};

// Get event categories
exports.getEventCategories = async (req, res) => {
  try {
    const categories = [
      "music",
      "sports",
      "art",
      "food",
      "business",
      "technology",
      "other"
    ];
    
    res.json({
      categories,
      count: categories.length
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to fetch categories", 
      error: error.message 
    });
  }
};

// Get available ticket types for an event
exports.getEventTicketTypes = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const eventInfo = await getEventTicketsInfo(event);
    
    res.json({
      eventId: event._id,
      eventTitle: event.title,
      ticketTypes: eventInfo.ticketTypes,
      soldOut: eventInfo.soldOut,
      totalTicketTypes: eventInfo.totalTicketTypes
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to fetch ticket types", 
      error: error.message 
    });
  }
};


exports.getEventTicketsInfo = getEventTicketsInfo;