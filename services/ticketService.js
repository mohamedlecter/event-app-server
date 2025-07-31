const Ticket = require("../Models/Ticket");
const User = require("../Models/Users");
const mongoose = require("mongoose");
const qrCodeService = require("./qrCodeService");

const createTickets = async (eventId, userId, quantity, ticketType, price, mainReference, recipientInfo, recipientType) => {
  const tickets = [];
  const ticketReferences = [];

  for (let i = 0; i < quantity; i++) {
    const ticketReference = `${mainReference}-TKT-${i}`;
    ticketReferences.push(ticketReference);

    const ticket = new Ticket({
      event: eventId,
      user: userId,
      recipientInfo: recipientInfo[i] || {
        type: recipientType,
        value: null,
        name: null
      },
      ticketType,
      price,
      reference: ticketReference,
      paymentReference: mainReference,
      status: "pending",
    });
    await ticket.save();
    tickets.push(ticket._id);
  }

  return { tickets, ticketReferences };
};

const transferTicket = async (ticketId, fromUserId, recipientInfo) => {
  const { recipientType, recipientValue, recipientName } = recipientInfo;

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    throw new Error("Ticket not found");
  }

  if (ticket.user.toString() !== fromUserId) {
    throw new Error("You don't own this ticket");
  }

  if (ticket.status !== "success") {
    throw new Error("Only paid tickets can be transferred");
  }

  // Find recipient user if they exist
  let recipientUser = null;
  if (recipientType === 'email') {
    recipientUser = await User.findOne({ email: recipientValue });
  } else {
    recipientUser = await User.findOne({ mobileNumber: recipientValue });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Remove ticket from current user's tickets array
    await User.findByIdAndUpdate(
      fromUserId,
      { $pull: { tickets: ticketId } },
      { session }
    );

    // If recipient is a registered user, add ticket to their tickets array
    if (recipientUser) {
      await User.findByIdAndUpdate(
        recipientUser._id,
        { $addToSet: { tickets: ticketId } },
        { session }
      );
      ticket.user = recipientUser._id;
    } else {
      ticket.user = null;
    }

    // Add transfer to history
    ticket.transferHistory.push({
      from: fromUserId,
      to: {
        type: recipientType,
        value: recipientValue,
        name: recipientName,
        user: recipientUser?._id
      },
      transferredAt: new Date(),
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    // Update ticket recipient info
    ticket.recipientInfo = {
      type: recipientType,
      value: recipientValue,
      name: recipientName
    };
    ticket.transferred = true;
    await ticket.save({ session });

    await session.commitTransaction();

    return {
      ticket,
      recipientInfo: {
        type: recipientType,
        value: recipientValue,
        name: recipientName,
        isRegisteredUser: !!recipientUser
      }
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const cancelTransfer = async (ticketId, userId) => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    throw new Error("Ticket not found");
  }

  if (ticket.user?.toString() !== userId) {
    throw new Error("You don't have permission to cancel this transfer");
  }

  const latestTransfer = ticket.transferHistory[ticket.transferHistory.length - 1];
  if (!latestTransfer || latestTransfer.status !== 'pending') {
    throw new Error("No pending transfer to cancel");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    latestTransfer.status = 'cancelled';
    latestTransfer.cancelledAt = new Date();
    latestTransfer.cancelledBy = userId;

    if (latestTransfer.to.user) {
      await User.findByIdAndUpdate(
        latestTransfer.to.user,
        { $pull: { tickets: ticketId } },
        { session }
      );
    }

    await User.findByIdAndUpdate(
      userId,
      { $addToSet: { tickets: ticketId } },
      { session }
    );

    ticket.user = userId;
    ticket.transferred = false;
    ticket.recipientInfo = null;
    await ticket.save({ session });

    await session.commitTransaction();

    return ticket;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getUserTickets = async (userId) => {
  return await Ticket.find({ user: userId })
    .populate("event")
    .sort({ createdAt: -1 });
};

const getTransferHistory = async (ticketId, userId) => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    throw new Error("Ticket not found");
  }

  if (ticket.user?.toString() !== userId) {
    throw new Error("You don't have permission to view this ticket's history");
  }

  return ticket.transferHistory || [];
};

// Add new function to generate QR code for a ticket
const generateTicketQR = async (ticketId) => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    throw new Error("Ticket not found");
  }

  if (ticket.status !== "success") {
    throw new Error("QR code can only be generated for paid tickets");
  }

  const qrCode = await qrCodeService.generateTicketQRCode(ticket);
  
  ticket.qrCode = qrCode;
  await ticket.save();

  return qrCode;
};

const getEventTickets = async (eventId) => {
  if (!eventId){
    throw new Error("Event id is required");
  }
  const tickets = await Ticket.find({event: eventId})

  if (!tickets){
    throw new Error("No tickets for this event");
  }

  return tickets;
}

module.exports = {
  createTickets,
  transferTicket,
  cancelTransfer,
  getUserTickets,
  getTransferHistory,
  generateTicketQR,
  getEventTickets
}; 