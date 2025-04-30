const mongoose = require("mongoose");
const Event = require("../Models/Event");
const Ticket = require("../Models/Ticket");
const Payment = require("../Models/Payments");
const { ObjectId } = mongoose.Types;

/**
 * Helper aggregation stages to filter Payments or Tickets for events created by this admin
 */
const getAdminEventsFilter = (adminId) => [
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
      "eventDetails.createdBy": new ObjectId(adminId),
    },
  },
];

/**
 * Fetch all events created by the logged-in admin
 */
exports.fetchAdminEvents = async (req, res) => {
  try {
    const adminId = req.user.id;

    const events = await Event.find({ createdBy: adminId }).sort({
      createdAt: -1,
    });

    if (!events.length) {
      return res.status(200).json([]);
    }

    res.json(events);
  } catch (error) {
    console.error("Error fetching admin events:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch events", error: error.message });
  }
};

/**
 * Get dashboard stats for admin: tickets sold, revenue, scanned tickets, etc.
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const adminId = req.user.id;

    // Count total events created by admin
    const totalEvents = await Event.countDocuments({
      createdBy: new ObjectId(adminId),
    });

    // Aggregate tickets sold, grouped by unique ticket to avoid duplicates
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
          _id: "$ticketDetails._id", // Group by ticket id to remove duplicates
          ticketType: { $first: "$ticketDetails.ticketType" },
        },
      },
      {
        $group: {
          _id: null,
          totalTicketsSold: { $sum: 1 },
          standardTicketsSold: {
            $sum: {
              $cond: [{ $eq: ["$ticketType", "standard"] }, 1, 0],
            },
          },
          vipTicketsSold: {
            $sum: {
              $cond: [{ $eq: ["$ticketType", "vip"] }, 1, 0],
            },
          },
        },
      },
    ]);

    // Aggregate total revenue from successful payments
    const revenueResult = await Payment.aggregate([
      ...getAdminEventsFilter(adminId),
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // Aggregate scanned tickets stats for admin's events
    const scannedStats = await Ticket.aggregate([
      ...getAdminEventsFilter(adminId),
      {
        $match: {
          status: "success",
          scanned: true,
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

/**
 * Get all payments for admin's events with user and ticket details
 */
exports.getAllPayments = async (req, res) => {
  try {
    const adminId = req.user.id;

    const payments = await Payment.aggregate([
      ...getAdminEventsFilter(adminId),
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
          "ticketDetails._id": 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    res.json(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch payments", error: error.message });
  }
};

/**
 * Search tickets by reference ID within admin's events
 */
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
      ...getAdminEventsFilter(adminId),
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
    console.error("Ticket search failed:", error);
    res
      .status(500)
      .json({ message: "Ticket search failed", error: error.message });
  }
};

/**
 * Scan a ticket with validation for admin ownership and status
 */
exports.scanTicket = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { ticketId } = req.params;

    // Verify ticket belongs to admin's event
    const ticket = await Ticket.aggregate([
      { $match: { _id: new ObjectId(ticketId) } },
      ...getAdminEventsFilter(adminId),
      { $limit: 1 },
    ]);

    if (!ticket.length) {
      return res.status(200).json([]);
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

    if (ticketDoc.scanned) {
      return res.status(400).json({ message: "Ticket already scanned" });
    }

    ticketDoc.scanned = true;
    ticketDoc.scannedAt = new Date();
    ticketDoc.scannedBy = adminId;
    await ticketDoc.save();

    res.json({ message: "Ticket scanned successfully", ticket: ticketDoc });
  } catch (error) {
    console.error("Ticket scanning failed:", error);
    res
      .status(500)
      .json({ message: "Ticket scanning failed", error: error.message });
  }
};

/**
 * Get analytics for a specific event (tickets remaining, revenue, payments)
 */

exports.getEventAnalytics = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ message: "Invalid event ID" });
    }

    const objectEventId = new mongoose.Types.ObjectId(eventId);

    const event = await Event.findOne({
      _id: objectEventId,
      createdBy: adminId,
    });

    if (!event) {
      return res.status(200).json([]);
    }

    const standardTicketsRemaining =
      event.standardTicket.quantity - event.standardTicket.sold;
    const vipTicketsRemaining = event.vipTicket.quantity - event.vipTicket.sold;

    const payments = await Payment.find({
      event: objectEventId,
      status: "success",
    })
      .populate("user", "name email")
      .sort({ createdAt: -1 });

    const revenueResult = await Payment.aggregate([
      { $match: { event: objectEventId, status: "success" } },
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
    console.error("Failed to fetch event analytics:", error);
    res
      .status(500)
      .json({
        message: "Failed to fetch event analytics",
        error: error.message,
      });
  }
};
