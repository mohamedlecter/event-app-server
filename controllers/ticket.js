const Event = require("../Models/event");

// Mark ticket as scanned (admin only)
exports.scanTicket = async (req, res) => {
  try {
    const { ticketId } = req.body;
    const { eventId } = req.params;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const ticket = event.tickets.id(ticketId);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    if (ticket.status === "scanned") {
      return res.status(400).json({ message: "Ticket already scanned" });
    }

    ticket.status = "scanned";
    ticket.scannedAt = new Date();
    ticket.scannedBy = req.user.id;

    await event.save();

    res.status(200).json({ message: "Ticket marked as scanned", ticket });
  } catch (error) {
    res.status(500).json({
      message: "Error scanning ticket",
      error: error.message,
    });
  }
};
