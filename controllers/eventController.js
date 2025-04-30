const Event = require("../Models/Event");
const Ticket = require("../Models/Ticket");
const Payment = require("../Models/Payments");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY,{
  apiVersion: '2023-08-16'
});

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

exports.initiatePayment = async (req, res) => {
  try {
    const { eventId } = req.params;
    console.log('Received eventId:', eventId); // Add this for debugging
    const { ticketType, quantity, recipientMobileNumbers = [] } = req.body;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ message: "Invalid event ID" });
    }

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

    // Generate unique references
    const mainReference = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const ticketReferences = [];
    for (let i = 0; i < quantity; i++) {
      ticketReferences.push(`${mainReference}-TKT-${i}`);
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${event.title} - ${ticketType} Ticket`,
              description: `Purchase of ${quantity} ${ticketType} ticket(s) for ${event.title}`,
            },
            unit_amount: amount * 100, // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `http://localhost:3000/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:3000/events/${eventId}`,
      client_reference_id: mainReference,
      metadata: {
        eventId,
        userId,
        ticketType,
        quantity,
        ticketReferences: JSON.stringify(ticketReferences),
      },
    });

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
        recipientMobileNumber: recipientMobileNumbers[i] || req.user.mobileNumber,
        ticketType,
        price: event[ticketField].price,
        reference: ticketReferences[i],
        paymentReference: mainReference,
        status: "pending",
      });
      await ticket.save();
      tickets.push(ticket._id);
    }

    // Update payment with tickets
    payment.tickets = tickets;
    await payment.save();

    res.json({ id: session.id });
  } catch (error) {
    console.error("Payment Initiation Error:", error);
    res.status(500).json({ 
      message: "Payment initiation failed", 
      error: error.message 
    });
  }
};

// Verify payment using Stripe
exports.verifyPayment = async (req, res) => {
  try {
    const { session_id } = req.body;
    
    // Retrieve the Stripe session
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const reference = session.client_reference_id;

    if (session.payment_status !== 'paid') {
      // Update payment and tickets to failed status if payment failed
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
      { paymentReference: reference },
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
      const reference = req.body.reference || req.body.session_id;
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
    const { recipientMobileNumber } = req.body;

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

    ticket.recipientMobileNumber = recipientMobileNumber;
    ticket.transferred == true;
    await ticket.save();

    res.json({ message: "Ticket transferred successfully", ticket });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ticket transfer failed", error: error.message });
  }
};
