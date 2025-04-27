const mongoose = require("mongoose");
const Event = require("../Models/Event");
const Ticket = require("../models/Ticket");
const Payment = require("../Models/Payment");
const { ObjectId } = mongoose.Types;

// Updated helper function with proper ObjectId creation
const getAdminEventsFilter = (adminId) => [
  {
    $lookup: {
      from: "events",
      localField: "event",
      foreignField: "_id",
      as: "eventDetails",
    },
  },
  {
    $unwind: "$eventDetails",
  },
  {
    $match: {
      "eventDetails.createdBy": new ObjectId(adminId),
    },
  },
];

exports.fetchAdminEvents = async (req, res) => {
  try {
    const adminId = req.user.id; // Get the logged-in admin's ID from the request (authentication middleware should have set this)

    // Fetch events created by the logged-in admin
    const events = await Event.find({ createdBy: adminId }).sort({
      createdAt: -1,
    });

    if (!events || events.length === 0) {
      return res
        .status(404)
        .json({ message: "No events found for this admin" });
    }

    res.json(events);
  } catch (error) {
    console.error("Error fetching events for admin:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch events", error: error.message });
  }
};

// Updated getDashboardStats with proper ObjectId usage
exports.getDashboardStats = async (req, res) => {
  try {
    const adminId = req.user.id;

    // Total events created by this admin
    const totalEvents = await Event.countDocuments({
      createdBy: new ObjectId(adminId),
    });

    // Ticket statistics aggregation
    const ticketStats = await Payment.aggregate([
      ...getAdminEventsFilter(adminId),
      { $match: { status: "success" } },
      { $unwind: "$tickets" },
      {
        $lookup: {
          from: "tickets",
          localField: "tickets",
          foreignField: "_id",
          as: "ticketDetails",
        },
      },
      { $unwind: "$ticketDetails" },
      {
        $group: {
          _id: null,
          totalTicketsSold: { $sum: 1 },
          standardTicketsSold: {
            $sum: {
              $cond: [{ $eq: ["$ticketDetails.ticketType", "standard"] }, 1, 0],
            },
          },
          vipTicketsSold: {
            $sum: {
              $cond: [{ $eq: ["$ticketDetails.ticketType", "vip"] }, 1, 0],
            },
          },
        },
      },
    ]);

    // Total revenue
    const revenueResult = await Payment.aggregate([
      ...getAdminEventsFilter(adminId),
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // Scanned tickets statistics
    const scannedStats = await Ticket.aggregate([
      {
        $lookup: {
          from: "events",
          localField: "event",
          foreignField: "_id",
          as: "eventDetails",
        },
      },
      { $unwind: "$eventDetails" },
      {
        $match: {
          status: "success",
          scanned: true,
          "eventDetails.createdBy": new ObjectId(adminId),
        },
      },
      {
        $group: {
          _id: null,
          totalScannedTickets: { $sum: 1 },
          standardScanned: {
            $sum: {
              $cond: [{ $eq: ["$ticketType", "standard"] }, 1, 0],
            },
          },
          vipScanned: {
            $sum: {
              $cond: [{ $eq: ["$ticketType", "vip"] }, 1, 0],
            },
          },
        },
      },
    ]);

    // Extract results
    const stats = ticketStats[0] || {
      totalTicketsSold: 0,
      standardTicketsSold: 0,
      vipTicketsSold: 0,
    };

    const scanned = scannedStats[0] || {
      totalScannedTickets: 0,
      standardScanned: 0,
      vipScanned: 0,
    };

    res.json({
      totalEvents,
      totalTicketsSold: stats.totalTicketsSold,
      standardTicketsSold: stats.standardTicketsSold,
      vipTicketsSold: stats.vipTicketsSold,
      totalRevenue: revenueResult[0]?.total || 0,
      totalScannedTickets: scanned.totalScannedTickets,
      standardScannedTickets: scanned.standardScanned,
      vipScannedTickets: scanned.vipScanned,
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({
      message: "Failed to fetch dashboard stats",
      error: error.message,
    });
  }
};

// Get all payments for admin's events
exports.getAllPayments = async (req, res) => {
  try {
    const adminId = req.user.id;

    const payments = await Payment.aggregate([
      ...getAdminEventsFilter(adminId), // Note the spread operator here
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: "$userDetails" },
      {
        $lookup: {
          from: "tickets",
          localField: "tickets",
          foreignField: "_id",
          as: "ticketDetails",
        },
      },
      {
        $project: {
          _id: 1,
          amount: 1,
          reference: 1,
          status: 1,
          createdAt: 1,
          "userDetails.name": 1,
          "userDetails.email": 1,
          "eventDetails.title": 1,
          "ticketDetails.scanned": 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    res.json(payments);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch payments",
      error: error.message,
    });
  }
};
// Search tickets by reference (admin's events only)
// Search tickets by reference (admin's events only)
exports.searchTickets = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { referenceId } = req.params;

    if (!referenceId) {
      return res.status(400).json({ message: "Reference is required" });
    }

    const tickets = await Ticket.aggregate([
      {
        $match: {
          reference: { $regex: referenceId, $options: "i" },
        },
      },
      ...getAdminEventsFilter(adminId), // Added spread operator here
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: "$userDetails" },
      {
        $project: {
          _id: 1,
          ticketType: 1,
          price: 1,
          reference: 1,
          status: 1,
          scanned: 1,
          scannedAt: 1,
          createdAt: 1,
          "eventDetails.title": 1,
          "eventDetails.date": 1,
          "userDetails.name": 1,
          "userDetails.email": 1,
        },
      },
    ]);

    res.json(tickets);
  } catch (error) {
    res.status(500).json({
      message: "Ticket search failed",
      error: error.message,
    });
  }
};

// Scan ticket (with admin event ownership check)
exports.scanTicket = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { ticketId } = req.params;

    // First verify the ticket belongs to admin's event
    const ticket = await Ticket.aggregate([
      { $match: { _id: mongoose.Types.ObjectId(ticketId) } },
      getAdminEventsFilter(adminId),
      { $limit: 1 },
    ]);

    if (!ticket || ticket.length === 0) {
      return res
        .status(404)
        .json({ message: "Ticket not found or not authorized" });
    }

    const ticketDoc = await Ticket.findById(ticketId).populate(
      "event",
      "title date"
    );

    if (ticketDoc.status !== "success") {
      return res
        .status(400)
        .json({ message: "Only paid tickets can be scanned" });
    }

    if (ticketDoc.scanned === true) {
      return res.status(400).json({ message: "Ticket already scanned" });
    }

    // Update ticket status to scanned
    ticketDoc.scanned = true;
    ticketDoc.scannedAt = new Date();
    ticketDoc.scannedBy = req.user.id;
    await ticketDoc.save();

    res.json({
      message: "Ticket scanned successfully",
      ticket: ticketDoc,
    });
  } catch (error) {
    res.status(500).json({
      message: "Ticket scanning failed",
      error: error.message,
    });
  }
};

// Get event analytics (with admin ownership check)
exports.getEventAnalytics = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { eventId } = req.params;

    // First verify the event belongs to the admin
    const event = await Event.findOne({
      _id: eventId,
      createdBy: adminId,
    });

    if (!event) {
      return res
        .status(404)
        .json({ message: "Event not found or not authorized" });
    }

    const standardTicketsRemaining =
      event.standardTicket.quantity - event.standardTicket.sold;
    const vipTicketsRemaining = event.vipTicket.quantity - event.vipTicket.sold;

    // Get payments for this event
    const payments = await Payment.find({
      event: eventId,
      status: "success",
    })
      .populate("user", "name email")
      .sort({ createdAt: -1 });

    // Calculate revenue
    const revenueResult = await Payment.aggregate([
      {
        $match: { event: mongoose.Types.ObjectId(eventId), status: "success" },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const revenue = revenueResult[0]?.total || 0;

    res.json({
      event,
      standardTicketsRemaining,
      vipTicketsRemaining,
      totalTicketsSold: event.standardTicket.sold + event.vipTicket.sold,
      revenue,
      payments,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch event analytics",
      error: error.message,
    });
  }
};
