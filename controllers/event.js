const Event = require("../Models/event");
const fs = require("fs");
const Payment = require("../Models/payment");
const mongoose = require("mongoose");

exports.getAllEvents = async (req, res) => {
  try {
    const events = await Event.find().populate("attendees", "username email");
    res.status(200).json(events);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching events", error: error.message });
  }
};

exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate(
      "attendees",
      "username email"
    );
    if (!event) return res.status(404).json({ message: "Event not found" });
    res.status(200).json(event);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching event", error: error.message });
  }
};

exports.createEvent = async (req, res) => {
  try {
    const photo = req.file ? req.file.path : null;
    const organizer = req.user.id;
    const eventData = { ...req.body, photo, organizer };
    const newEvent = new Event(eventData);
    const savedEvent = await newEvent.save();
    res.status(201).json(savedEvent);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error creating event", error: error.message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });

    if (req.file && event.photo) fs.unlinkSync(event.photo);
    const updates = { ...req.body };
    if (req.file) updates.photo = req.file.path;

    const updatedEvent = await Event.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    res.status(200).json(updatedEvent);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating event", error: error.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });
    await Event.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting event", error: error.message });
  }
};

exports.getMyEvents = async (req, res) => {
  try {
    // Find events where the current user is the organizer (i.e., created the event)
    const events = await Event.find({ organizer: req.user.id })
      .populate("attendees", "username email")
      .populate("tickets.user", "name email");

    res.status(200).json(events);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching admin-created events",
      error: error.message,
    });
  }
};
// Get all purchased events for the logged-in user
exports.getMyPurchasedEvents = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all successful payments made by the user
    const payments = await Payment.find({
      user: userId,
      status: "success",
    }).populate("event");

    // Extract unique events
    const events = payments.map((payment) => payment.event);

    res.json({ events });
  } catch (error) {
    console.error("Error fetching purchased events:", error);
    res.status(500).json({
      message: "Failed to fetch purchased events",
      error: error.message,
    });
  }
};

// Get detailed info about a purchased event and its transaction
exports.getPurchasedEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    // Find the payment record for this event and user
    const payment = await Payment.findOne({
      user: userId,
      event: eventId,
      status: "success",
    }).populate("event");

    if (!payment) {
      return res
        .status(404)
        .json({ message: "No purchase found for this event" });
    }

    res.json({ event: payment.event, transaction: payment });
  } catch (error) {
    console.error("Error fetching purchased event:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch event details", error: error.message });
  }
};
exports.initiatePayment = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { ticketType, quantity } = req.body;
    const userId = req.user.id;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.soldOut)
      return res.status(400).json({ message: "Event is sold out" });

    // Calculate total amount
    const ticketPrice =
      ticketType === "vip" ? event.vipTicketPrice : event.standardTicketPrice;
    const amount = ticketPrice * quantity;

    // Initialize Paystack payment
    const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);
    const reference = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const paymentData = {
      email: req.user.email,
      amount: amount * 100, // Convert to kobo
      reference,
      metadata: { eventId, userId, ticketType, quantity },
      callback_url: "http://localhost:3000/payment-success", // Redirect to frontend success page
    };

    const response = await paystack.transaction.initialize(paymentData);

    // Save payment record
    await Payment.create({
      user: userId,
      event: eventId,
      amount,
      reference,
      ticketType,
      quantity,
      status: "pending", // Set initial status to pending
    });

    res.json({ authorizationUrl: response.data.authorization_url });
  } catch (error) {
    console.error("Payment Initiation Error:", error);
    res
      .status(500)
      .json({ message: "Payment initiation failed", error: error.message });
  }
};

// Verify payment manually (called by frontend after payment)
exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;

    console.log("Payment Verification Request:", reference);

    const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);
    const verification = await paystack.transaction.verify({ reference });

    console.log("Paystack Verification Response:", verification);

    if (verification.data.status !== "success") {
      return res.status(400).json({ message: "Payment failed" });
    }

    // Find the payment record
    const payment = await Payment.findOne({ reference });
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Update payment status
    payment.status = "success";
    await payment.save();

    // Add attendees to the event
    const event = await Event.findById(payment.event);
    if (event.attendees.length + payment.quantity > event.capacity) {
      payment.status = "failed";
      await payment.save();
      return res.status(400).json({ message: "Event capacity exceeded" });
    }

    for (let i = 0; i < payment.quantity; i++) {
      event.attendees.push(payment.user);
      event.tickets.push({
        user: payment.user,
        status: "not-scanned",
      });
    }
    if (event.attendees.length >= event.capacity) event.soldOut = true;
    await event.save();

    res.json({ message: "Payment verified successfully" });
  } catch (error) {
    console.error("Payment Verification Error:", error);
    res
      .status(500)
      .json({ message: "Payment verification failed", error: error.message });
  }
};
