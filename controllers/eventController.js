const Event = require("../Models/Event");
const Ticket = require("../models/Ticket");
const Payment = require("../Models/Payment");

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
    } = req.body;

    const event = new Event({
      title,
      description,
      location: { country, city },
      standardTicket: {
        price: standardPrice,
        quantity: standardQuantity,
      },
      vipTicket: {
        price: vipPrice,
        quantity: vipQuantity,
      },
      date,
      category,
      createdBy: req.user.id,
      image: req.file ? req.file.path : undefined,
    });

    await event.save();

    res.status(201).json(event);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Event creation failed", error: error.message });
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

// Get event details
exports.getEventDetails = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.json(event);
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

// Initiate payment for tickets
exports.initiatePayment = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { ticketType, quantity, recipientEmails = [] } = req.body;
    const userId = req.user.id;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.soldOut)
      return res.status(400).json({ message: "Event is sold out" });

    // Check ticket availability
    const ticketField = ticketType === "vip" ? "vipTicket" : "standardTicket";
    if (event[ticketField].sold + quantity > event[ticketField].quantity) {
      return res.status(400).json({ message: "Not enough tickets available" });
    }

    // Calculate total amount
    const amount = event[ticketField].price * quantity;

    // Initialize Paystack payment
    const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);
    const mainReference = `PAY-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    // Generate unique references for each ticket
    const ticketReferences = [];
    for (let i = 0; i < quantity; i++) {
      ticketReferences.push(`${mainReference}-TKT-${i}`);
    }

    const paymentData = {
      email: req.user.email,
      amount: amount * 100, // Convert to kobo
      reference: mainReference,
      metadata: {
        eventId,
        userId,
        ticketType,
        quantity,
        ticketReferences: JSON.stringify(ticketReferences), // Store all ticket references
      },
      callback_url: "http://localhost:3000/payment-success",
    };

    const response = await paystack.transaction.initialize(paymentData);

    // Create payment record
    const payment = await Payment.create({
      user: userId,
      event: eventId,
      amount,
      reference: mainReference,
      status: "pending",
    });

    // Create ticket records with individual references
    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticket = new Ticket({
        event: eventId,
        user: userId,
        recipientEmail: recipientEmails[i] || req.user.email,
        ticketType,
        price: event[ticketField].price,
        reference: ticketReferences[i], // Use the generated reference
        paymentReference: mainReference, // Link to parent payment
        status: "pending",
      });
      await ticket.save();
      tickets.push(ticket._id);
    }

    // Update payment with tickets
    payment.tickets = tickets;
    await payment.save();

    res.json({
      authorizationUrl: response.data.authorization_url,
      mainReference,
      ticketReferences, // Optional: return ticket references to frontend
    });
  } catch (error) {
    console.error("Payment Initiation Error:", error);
    res
      .status(500)
      .json({ message: "Payment initiation failed", error: error.message });
  }
};

// Verify payment
// Verify payment and update ticket statuses
exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    console.log("Payment Verification Request:", reference);

    const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);
    const verification = await paystack.transaction.verify({ reference });

    console.log("Paystack Verification Response:", verification);

    if (verification.data.status !== "success") {
      // Update payment and tickets to failed status if verification fails
      await Payment.findOneAndUpdate(
        { reference },
        { $set: { status: "failed" } }
      );

      await Ticket.updateMany(
        { paymentReference: reference },
        { $set: { status: "failed" } }
      );

      return res.status(400).json({ message: "Payment failed" });
    }

    // Find the payment record
    const payment = await Payment.findOne({ reference })
      .populate("tickets")
      .populate("event")
      .populate("user", "name email");

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Check if tickets would exceed event capacity
    const ticketType = payment.tickets[0].ticketType;
    const ticketField = ticketType === "vip" ? "vipTicket" : "standardTicket";
    const event = await Event.findById(payment.event);

    if (
      event[ticketField].sold + payment.tickets.length >
      event[ticketField].quantity
    ) {
      // Revert payment and tickets if capacity would be exceeded
      payment.status = "failed";
      await payment.save();

      await Ticket.updateMany(
        { paymentReference: reference },
        { $set: { status: "failed" } }
      );

      return res.status(400).json({ message: "Event capacity exceeded" });
    }

    // Update payment status
    payment.status = "success";
    await payment.save();

    // Update all related tickets
    await Ticket.updateMany(
      { paymentReference: reference }, // Now this will match
      { $set: { status: "success" } }
    );

    // Update event ticket counts
    await Event.findByIdAndUpdate(payment.event, {
      $inc: { [`${ticketField}.sold`]: payment.tickets.length },
      $set: {
        soldOut:
          event.standardTicket.sold >= event.standardTicket.quantity &&
          event.vipTicket.sold >= event.vipTicket.quantity,
      },
    });

    // Refresh payment data after updates
    const updatedPayment = await Payment.findById(payment._id)
      .populate("tickets")
      .populate("event")
      .populate("user", "name email");

    res.json({
      message: "Payment verified successfully",
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("Payment Verification Error:", error);

    // Mark payment and tickets as failed on error
    try {
      await Payment.findOneAndUpdate(
        { reference },
        { $set: { status: "failed" } }
      );

      await Ticket.updateMany(
        { paymentReference: reference },
        { $set: { status: "failed" } }
      );
    } catch (dbError) {
      console.error("Failed to update statuses on error:", dbError);
    }

    res.status(500).json({
      message: "Payment verification failed",
      error: error.message,
    });
  }
};
// Get user's tickets
exports.getUserTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find({ user: req.user.id })
      .populate("event")
      .sort({ createdAt: -1 });
    res.json(tickets);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch tickets", error: error.message });
  }
};

// Transfer ticket to another user
exports.transferTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { recipientEmail } = req.body;

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.user.toString() !== req.user.id) {
      return res.status(403).json({ message: "You don't own this ticket" });
    }

    if (ticket.status !== "success") {
      return res
        .status(400)
        .json({ message: "Only paid tickets can be transferred" });
    }

    ticket.recipientEmail = recipientEmail;
    ticket.transferred == true;
    await ticket.save();

    res.json({ message: "Ticket transferred successfully", ticket });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ticket transfer failed", error: error.message });
  }
};
