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
      standardPrice,
      standardQuantity,
      vipPrice,
      vipQuantity,
      date,
      category,
      image
    } = req.body;

    // Validate required fields
    if (!title || !country || !city || !standardPrice || !standardQuantity || 
        !vipPrice || !vipQuantity || !date || !category) {
      return res.status(400).json({
        message: "Missing required fields",
        required: {
          title: "Event title",
          country: "Country",
          city: "City",
          standardPrice: "Standard ticket price",
          standardQuantity: "Standard ticket quantity",
          vipPrice: "VIP ticket price",
          vipQuantity: "VIP ticket quantity",
          date: "Event date",
          category: "Event category"
        }
      });
    }

    // Validate category
    const validCategories = ["music", "sports", "art", "food", "business", "technology", "other"];
    if (!validCategories.includes(category.toLowerCase())) {
      return res.status(400).json({
        message: "Invalid category",
        validCategories
      });
    }

    // Validate prices and quantities
    if (standardPrice <= 0 || vipPrice <= 0) {
      return res.status(400).json({
        message: "Prices must be greater than 0"
      });
    }

    if (standardQuantity <= 0 || vipQuantity <= 0) {
      return res.status(400).json({
        message: "Quantities must be greater than 0"
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

    const event = new Event({
      title,
      description,
      location: { 
        country, 
        city 
      },
      standardTicket: {
        price: Number(standardPrice),
        quantity: Number(standardQuantity),
        sold: 0
      },
      vipTicket: {
        price: Number(vipPrice),
        quantity: Number(vipQuantity),
        sold: 0
      },
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

    const countByType = (type) =>
        tickets.filter((t) => t.ticketType === type && t.status === 'success').length;

    const vipSold = countByType("vip");
    const standardSold = countByType("standard");

    const vipAvailable = event.vipTicket.quantity - vipSold;
    const standardAvailable = event.standardTicket.quantity - standardSold;

    const soldOut = vipAvailable <= 0 && standardAvailable <= 0;

    return {
      standardTicketsSold: standardSold,
      vipTicketsSold: vipSold,
      standardTicketsAvailable: standardAvailable,
      vipTicketsAvailable: vipAvailable,
      soldOut,
    };
  } catch (err) {
    console.error("Error fetching event tickets:", err);
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
      ticketType,
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

    const ticketField = ticketType === "vip" ? "vipTicket" : "standardTicket";
    // if (event[ticketField].sold + quantity > event[ticketField].quantity) {
    //   return res.status(400).json({ message: "Not enough tickets available" });
    // }

    const amount = event[ticketField].price * quantity;
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
      ticketType,
      event[ticketField].price,
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
        ticketType,
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

    // Update event ticket counts
    const ticketType = tickets[0].ticketType;
    const ticketField = ticketType === "vip" ? "vipTicket" : "standardTicket";
    const event = await Event.findById(payment.event);

    await Event.findByIdAndUpdate(payment.event, {
      $inc: { [`${ticketField}.sold`]: tickets.length },
    });

    const updatedEvent = await Event.findById(payment.event);

    const totalSold = updatedEvent.standardTicket.sold + updatedEvent.vipTicket.sold;
    const totalAvailable =
        updatedEvent.standardTicket.quantity + updatedEvent.vipTicket.quantity;

    if (totalSold >= totalAvailable) {
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


exports.getEventTicketsInfo = getEventTicketsInfo;