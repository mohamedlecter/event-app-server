const Event = require("../Models/Event");
const Ticket = require("../models/Ticket");
const Payment = require("../Models/Payment");

// Admin dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    // Total events
    const totalEvents = await Event.countDocuments();

    // Total tickets sold
    const standardTicketsSold = (await Event.aggregate([
      { $group: { _id: null, total: { $sum: "$standardTicket.sold" } } }
    ]))[0]?.total || 0;

    const vipTicketsSold = (await Event.aggregate([
      { $group: { _id: null, total: { $sum: "$vipTicket.sold" } } }
    ]))[0]?.total || 0;

    const totalTicketsSold = standardTicketsSold + vipTicketsSold;

    // Total revenue
    const revenueResult = await Payment.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalRevenue = revenueResult[0]?.total || 0;
    // Total scanned tickets
    const scannedTicketsResult = await Ticket.aggregate([
        { $match: { status: "success", scanned: true } },
        { $group: { _id: null, total: { $sum: 1 } } }
    ]);
    const totalScannedTickets = scannedTicketsResult[0]?.total || 0;

    res.json({
        totalEvents,
        totalTicketsSold,
        standardTicketsSold,
        vipTicketsSold,
        totalRevenue,
        totalScannedTickets
    });
    } catch (error) {
    res.status(500).json({ message: "Failed to fetch dashboard stats", error: error.message });
    }
    };

// Get all payments
exports.getAllPayments = async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate("user", "name email")
      .populate("event", "title")
      .sort({ createdAt: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payments", error: error.message });
  }
};

// Search tickets by reference
exports.searchTickets = async (req, res) => {
  try {
    const { referenceId } = req.params;
    console.log("Reference:", referenceId); // Debugging line
    
    if (!referenceId) {
      return res.status(400).json({ message: "Reference is required" });
    }

    const tickets = await Ticket.find({ reference: { $regex: referenceId, $options: "i" } })
      .populate("event", "title date")
      .populate("user", "name email");

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: "Ticket search failed", error: error.message });
  }
};

// Scan ticket
exports.scanTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findById(ticketId).populate("event", "title date");
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.status !== "success") {
      return res.status(400).json({ message: "Only paid tickets can be scanned" });
    }

    if (ticket.scanned === true) {
      return res.status(400).json({ message: "Ticket already scanned" });
    }

    // Update ticket status to scanned
    ticket.scanned = true;
    ticket.scannedAt = new Date();
    ticket.scannedBy = req.user.id;
    await ticket.save();

    res.json({ message: "Ticket scanned successfully", ticket });
  } catch (error) {
    res.status(500).json({ message: "Ticket scanning failed", error: error.message });
  }
};

// Get event analytics
exports.getEventAnalytics = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const standardTicketsRemaining = event.standardTicket.quantity - event.standardTicket.sold;
    const vipTicketsRemaining = event.vipTicket.quantity - event.vipTicket.sold;

    // Get payments for this event
    const payments = await Payment.find({ event: eventId, status: "success" })
      .populate("user", "name email")
      .sort({ createdAt: -1 });

    // Calculate revenue
    const revenueResult = await Payment.aggregate([
      { $match: { event: eventId, status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
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
    res.status(500).json({ message: "Failed to fetch event analytics", error: error.message });
  }
};