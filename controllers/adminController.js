const mongoose = require("mongoose");
const Event = require("../Models/EventModel");
const Ticket = require("../Models/Ticket");
const Payment = require("../Models/Payments");
const { getEventTicketsInfo } = require('./eventController');
const { ObjectId } = mongoose.Types;
const qrCodeService = require("../services/qrCodeService");

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
          ticketsByType: {
            $push: "$ticketType"
          }
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
          scannedByType: {
            $push: "$ticketType"
          }
        },
      },
    ]);

    // Process ticket stats by type
    const stats = ticketStats[0] || {
      totalTicketsSold: 0,
      ticketsByType: []
    };

    const scanned = scannedStats[0] || {
      totalScannedTickets: 0,
      scannedByType: []
    };

    // Count tickets by type
    const ticketsByType = {};
    stats.ticketsByType.forEach(type => {
      ticketsByType[type] = (ticketsByType[type] || 0) + 1;
    });

    const scannedByType = {};
    scanned.scannedByType.forEach(type => {
      scannedByType[type] = (scannedByType[type] || 0) + 1;
    });

    res.json({
      totalEvents,
      totalTicketsSold: stats.totalTicketsSold,
      ticketsByType,
      totalRevenue: revenueResult[0]?.total || 0,
      totalScannedTickets: scanned.totalScannedTickets,
      scannedByType,
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
          "userDetails.mobileNumber": 1,
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
    const { ticketId, qrData } = req.body;

    let ticket;
    
    // If QR data is provided, verify it first
    if (qrData) {
      try {
        const verifiedData = qrCodeService.verifyQRCode(qrData);
        ticket = await Ticket.findById(verifiedData.ticketId);
      } catch (error) {
        return res.status(400).json({ 
          message: "Invalid QR code", 
          error: error.message 
        });
      }
    } else if (ticketId) {
      // Find ticket by ID
      ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found with this ID" });
      }
    } else {
      return res.status(400).json({ 
        message: "Either ticketId or qrData is required" 
      });
    }

    // Verify the ticket belongs to an event created by this admin
    const ticketBelongsToAdmin = await Ticket.aggregate([
      { $match: { _id: ticket._id } },
      ...getAdminEventsFilter(adminId),
      { $limit: 1 },
    ]);

    if (!ticketBelongsToAdmin.length) {
      return res.status(403).json({ 
        message: "You are not authorized to scan this ticket" 
      });
    }

    // Populate event details
    ticket = await Ticket.findById(ticket._id).populate("event", "title date");

    // Check ticket status
    if (ticket.status !== "success") {
      return res
        .status(400)
        .json({ 
          message: "Only paid tickets can be scanned",
          ticketStatus: ticket.status
        });
    }

    // Check if ticket is already scanned
    if (ticket.scanned) {
      return res.status(400).json({ 
        message: "Ticket already scanned",
        scannedAt: ticket.scannedAt,
        scannedBy: ticket.scannedBy,
        ticketId: ticket._id,
        reference: ticket.reference
      });
    }

    // Check if the event date has passed
    const eventDate = new Date(ticket.event.date);
    if (eventDate < new Date()) {
      return res.status(400).json({
        message: "Cannot scan ticket for past event",
        eventDate: eventDate,
        ticketId: ticket._id
      });
    }

    // Update ticket with scan information
    ticket.scanned = true;
    ticket.scannedAt = new Date();
    ticket.scannedBy = adminId;
    await ticket.save();

    // Log the successful scan
    console.log(`Ticket ${ticket._id} (${ticket.reference}) scanned successfully by admin ${adminId} at ${ticket.scannedAt}`);

    res.json({ 
      message: "Ticket scanned successfully", 
      ticket: {
        id: ticket._id,
        reference: ticket.reference,
        ticketType: ticket.ticketType,
        scannedAt: ticket.scannedAt,
        event: ticket.event
      }
    });
  } catch (error) {
    console.error("Ticket scanning failed:", error);
    res
      .status(500)
      .json({ 
        message: "Ticket scanning failed", 
        error: error.message,
        timestamp: new Date()
      });
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

    const eventInfo = await getEventTicketsInfo(event);

    if (!eventInfo){
      throw new Error("Unable to retrieve the event info");
    }

    // Calculate tickets remaining for each ticket type
    const ticketsRemaining = {};
    event.ticketTypes.forEach(ticketType => {
      const sold = eventInfo.ticketTypes.find(tt => tt.name === ticketType.name)?.sold || 0;
      ticketsRemaining[ticketType.name] = ticketType.quantity - sold;
    });

    const payments = await Payment.find({
      event: objectEventId,
      status: "success",
    })
      .populate("user", "name email mobileNumber")
      .sort({ createdAt: -1 });

    const revenueResult = await Payment.aggregate([
      { $match: { event: objectEventId, status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const revenue = revenueResult[0]?.total || 0;

    res.json({
      event,
      eventInfo,
      ticketsRemaining,
      totalTicketsSold: eventInfo.ticketTypes.reduce((total, tt) => total + tt.sold, 0),
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
