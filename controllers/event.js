const Event = require("../Models/event");
const User = require("../Models/user");
const fs = require("fs");
const mongoose = require("mongoose");
const Payment = require("../Models/payment");
const crypto = require("crypto");

// Get all events (Public access)
const getAllEvents = async (req, res) => {
  try {
    const events = await Event.find().populate("attendees", "username email");
    res.status(200).json(events);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching events", error: error.message });
  }
};

// Get a single event by ID (Public access)
const getEventById = async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId).populate(
      "attendees",
      "username email"
    );

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json(event);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching event", error: error.message });
  }
};

const createEvent = async (req, res) => {
  try {
    console.log("Logged-in User:", req.user); // Debugging: Check req.user

    const {
      title,
      description,
      isOnline,
      location,
      startDate,
      endDate,
      startTime,
      endTime,
      duration,
      isFree,
      price,
      category,
      tags,
      attendees,
      soldOut,
      url,
    } = req.body;

    // Set the organizer to the logged-in user's ID
    const organizer = req.user.id;
    console.log("Organizer ID:", organizer); // Debugging: Check organizer ID

    // Get the uploaded file path
    const photo = req.file ? req.file.path : null;

    const newEvent = new Event({
      title,
      description,
      photo,
      isOnline,
      location,
      startDate,
      endDate,
      startTime,
      endTime,
      duration,
      isFree,
      price,
      category,
      tags,
      organizer, // Set the organizer to the logged-in user's ID
      attendees,
      soldOut,
      url,
    });

    const savedEvent = await newEvent.save();
    res.status(201).json(savedEvent);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error creating event", error: error.message });
  }
};

// Update an event by ID (Admins or the organizer only)
const updateEvent = async (req, res) => {
  try {
    const eventId = req.params.id;
    const updates = req.body;

    // Check if the logged-in user is the organizer or an admin
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (
      event.organizer.toString() !== req.user._id &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        message: "Access denied. You are not the organizer or an admin.",
      });
    }

    // If a new photo is uploaded, delete the old photo
    if (req.file) {
      if (event.photo) {
        fs.unlinkSync(event.photo); // Delete the old photo
      }
      updates.photo = req.file.path; // Set the new photo path
    }

    const updatedEvent = await Event.findByIdAndUpdate(eventId, updates, {
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

const deleteEvent = async (req, res) => {
  try {
    const eventId = req.params.id;

    // Check if the logged-in user is the organizer or an admin
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (
      event.organizer.toString() !== req.user._id &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        message: "Access denied. You are not the organizer or an admin.",
      });
    }

    await Event.findByIdAndDelete(eventId);
    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting event", error: error.message });
  }
};

const getMyEvents = async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user._id });
    res.status(200).json(events);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching events", error: error.message });
  }
};
// Initiate Paystack payment
const initiatePayment = async (req, res) => {
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
const verifyPayment = async (req, res) => {
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

    event.attendees.push(...Array(payment.quantity).fill(payment.user));
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
const updateTicketStatus = async (req, res) => {
  try {
    const { ticketId, status } = req.body;

    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const ticket = event.tickets.id(ticketId);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    ticket.status = status;
    if (status === "scanned") {
      ticket.scannedAt = new Date();
      ticket.scannedBy = req.user.id;
    }

    await event.save();

    res.json({ message: "Ticket status updated successfully" });
  } catch (error) {
    console.error("Ticket Status Update Error:", error);
    res
      .status(500)
      .json({ message: "Ticket status update failed", error: error.message });
  }
};

// Get all purchased events for the logged-in user
const getMyPurchasedEvents = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log("Logged-in User ID:", userId);

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
const getPurchasedEvent = async (req, res) => {
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

module.exports = {
  createEvent,
  updateEvent,
  getAllEvents,
  getEventById,
  deleteEvent,
  getMyEvents,
  initiatePayment,
  verifyPayment,
  updateTicketStatus,
  getMyPurchasedEvents,
  getPurchasedEvent,
};
