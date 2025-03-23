const Event = require("../Models/event");
const User = require("../Models/user");
const fs = require("fs");
const mongoose = require("mongoose");

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

const getMyPurchasedEvents = async (req, res) => {
  try {
    const events = await Event.find({ attendees: req.user._id });
    res.status(200).json(events);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching events", error: error.message });
  }
};

const getEventAttendees = async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId).populate("attendees");

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json(event.attendees);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching attendees", error: error.message });
  }
};
const attendEvent = async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const userId = req.params.userId;
    const { ticketCount } = req.body;

    console.log("[DEBUG] Event ID:", eventId);
    console.log("[DEBUG] User ID:", userId);
    console.log("[DEBUG] Ticket Count:", ticketCount);

    // Validate user ID
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    // Validate event ID
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ message: "Invalid event ID" });
    }

    // Find the event
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Check if event is sold out
    if (event.soldOut) {
      return res.status(400).json({ message: "This event is sold out" });
    }

    // Check if user is already registered
    const isRegistered = event.attendees.some(
      (attendeeId) => attendeeId.toString() === userId
    );

    if (isRegistered) {
      return res.status(400).json({
        message: "User is already registered for this event",
      });
    }

    // Add user to attendees for each ticket
    for (let i = 0; i < ticketCount; i++) {
      event.attendees.push(userId);
    }

    await event.save();

    // Return updated event
    const updatedEvent = await Event.findById(eventId)
      .populate("attendees", "username email")
      .populate("organizer", "username");

    res.status(200).json({
      message: "Successfully registered for the event",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("[ERROR] Attendance error:", error);
    res.status(500).json({
      message: "Error registering for event",
      error: error.message,
    });
  }
};

module.exports = {
  createEvent,
  updateEvent,
  getAllEvents,
  getEventById,
  deleteEvent,
  getMyEvents,
  getEventAttendees,
  attendEvent,
  getMyPurchasedEvents,
};
