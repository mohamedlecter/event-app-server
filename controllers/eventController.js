const Event = require("../Models/EventModel");
const Ticket = require("../Models/Ticket");
const Payment = require("../Models/Payments");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-08-16",
});
// Wave Configuration
const waveConfig = {
  apiKey: process.env.WAVE_API_KEY,
  apiUrl: "https://api.wave.com/v1",
};

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
// Helper function to create Wave checkout session
const createWaveCheckout = async (amount, currency, reference, callbackUrl) => {
  try {
    const response = await axios.post(
      `${waveConfig.apiUrl}/checkout/sessions`,
      {
        amount: amount.toString(),
        currency: currency,
        error_url: callbackUrl,
        success_url: callbackUrl,
        client_reference_id: reference,
        metadata: {
          payment_reference: reference,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${waveConfig.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("Wave API Error:", error.response?.data || error.message);
    throw new Error("Failed to create Wave checkout session");
  }
};

// Initiate Payment
exports.initiatePayment = async (req, res) => {
  let mainReference;

  try {
    const { eventId } = req.params;
    const {
      ticketType,
      quantity,
      recipientMobileNumbers = [],
      paymentGateway = "stripe",
    } = req.body;
    const userId = req.user.id;

    // Input validation
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.soldOut) {
      return res.status(400).json({ message: "Event is sold out" });
    }

    // Check ticket availability
    const ticketField = ticketType === "vip" ? "vipTicket" : "standardTicket";
    if (event[ticketField].sold + quantity > event[ticketField].quantity) {
      return res.status(400).json({ message: "Not enough tickets available" });
    }

    // Calculate total amount
    const amount = event[ticketField].price * quantity;

    // Generate unique references
    mainReference = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const ticketReferences = [];
    for (let i = 0; i < quantity; i++) {
      ticketReferences.push(`${mainReference}-TKT-${i}`);
    }

    // Create payment record
    const payment = await Payment.create({
      user: userId,
      event: eventId,
      amount,
      reference: mainReference,
      status: "pending",
      paymentGateway,
    });

    // Create ticket records
    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticket = new Ticket({
        event: eventId,
        user: userId,
        recipientMobileNumber:
          recipientMobileNumbers[i] || req.user.mobileNumber,
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

    // Process payment based on selected gateway
    if (paymentGateway === "wave") {
      // Create Wave checkout session
      const waveSession = await createWaveCheckout(
        amount,
        "XOF", // Using XOF as shown in Wave docs
        mainReference,
        `${process.env.FRONTEND_URL}/payment-success?reference=${mainReference}`
      );

      return res.json({
        id: waveSession.id,
        paymentUrl: waveSession.payment_url || waveSession.url,
        gateway: "wave",
      });
    } else {
      // Default to Stripe
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${event.title} - ${ticketType} Ticket`,
                description: `Purchase of ${quantity} ${ticketType} ticket(s) for ${event.title}`,
              },
              unit_amount: amount * 100,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/events/${eventId}`,
        client_reference_id: mainReference,
        metadata: {
          eventId,
          userId,
          ticketType,
          quantity,
          ticketReferences: JSON.stringify(ticketReferences),
        },
      });

      return res.json({ id: session.id, gateway: "stripe" });
    }
  } catch (error) {
    console.error("Payment Initiation Error:", error);

    // Clean up failed payment records if reference was created
    if (mainReference) {
      await Payment.deleteOne({ reference: mainReference }).catch(
        (cleanupError) => {
          console.error("Failed to clean up payment:", cleanupError);
        }
      );
      await Ticket.deleteMany({ paymentReference: mainReference }).catch(
        (cleanupError) => {
          console.error("Failed to clean up tickets:", cleanupError);
        }
      );
    }

    res.status(500).json({
      message: "Payment initiation failed",
      error: error.message,
      details: error.response?.data || undefined,
    });
  }
};

// Verify Payment
exports.verifyPayment = async (req, res) => {
  try {
    const { session_id, reference, gateway } = req.body;

    if (gateway === "stripe") {
      // Stripe verification logic
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ["payment_intent"],
      });
      const paymentReference = session.client_reference_id;

      if (session.payment_status !== "paid") {
        await Payment.findOneAndUpdate(
          { reference: paymentReference },
          { $set: { status: "failed" } }
        );

        await Ticket.updateMany(
          { paymentReference: paymentReference },
          { $set: { status: "failed" } }
        );

        return res.status(400).json({
          message: "Payment failed",
          details: session.payment_intent?.last_payment_error || null,
        });
      }

      // Find the payment record
      const payment = await Payment.findOne({ reference: paymentReference })
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
        // Refund the payment if capacity is exceeded
        try {
          await stripe.refunds.create({
            payment_intent: session.payment_intent.id,
          });
        } catch (refundError) {
          console.error("Refund failed:", refundError);
        }

        // Update statuses to failed
        payment.status = "refunded";
        await payment.save();

        await Ticket.updateMany(
          { paymentReference: paymentReference },
          { $set: { status: "failed" } }
        );

        return res
          .status(400)
          .json({ message: "Event capacity exceeded - payment refunded" });
      }

      // Update payment status
      payment.status = "success";
      payment.stripePaymentIntent = session.payment_intent.id;
      await payment.save();

      // Update all related tickets
      await Ticket.updateMany(
        { paymentReference: paymentReference },
        { $set: { status: "success" } }
      );

      // Update event ticket counts
      await Event.findByIdAndUpdate(payment.event, {
        $inc: { [`${ticketField}.sold`]: payment.tickets.length },
        $set: {
          soldOut:
            event.standardTicket.sold +
              (ticketField === "standardTicket" ? payment.tickets.length : 0) >=
              event.standardTicket.quantity &&
            event.vipTicket.sold +
              (ticketField === "vipTicket" ? payment.tickets.length : 0) >=
              event.vipTicket.quantity,
        },
      });

      // Refresh payment data after updates
      const updatedPayment = await Payment.findById(payment._id)
        .populate("tickets")
        .populate("event")
        .populate("user", "name email");

      return res.json({
        message: "Stripe payment verified successfully",
        payment: updatedPayment,
      });
    } else if (gateway === "wave") {
      // Wave verification logic - direct API verification (not recommended for production)
      const payment = await Payment.findOne({ reference })
        .populate("tickets")
        .populate("event")
        .populate("user", "name email");

      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      // Verify payment with Wave API directly
      try {
        const waveResponse = await axios.get(
          `${waveConfig.apiUrl}/checkout/sessions/${reference}`,
          {
            headers: {
              Authorization: `Bearer ${waveConfig.apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        const waveData = waveResponse.data;

        // Check payment status according to Wave's API
        if (
          waveData.status !== "completed" &&
          waveData.payment_status !== "paid"
        ) {
          payment.status = "failed";
          await payment.save();
          await Ticket.updateMany(
            { paymentReference: reference },
            { $set: { status: "failed" } }
          );
          return res.status(400).json({
            message: "Wave payment not completed",
            waveStatus: waveData.status,
          });
        }

        // Update payment status
        payment.status = "success";
        payment.wavePaymentId = waveData.id;
        payment.waveTransactionId = waveData.transaction_id;
        await payment.save();

        // Update tickets
        await Ticket.updateMany(
          { paymentReference: reference },
          { $set: { status: "success" } }
        );

        // Update event ticket counts
        const ticketType = payment.tickets[0].ticketType;
        const ticketField =
          ticketType === "vip" ? "vipTicket" : "standardTicket";
        const event = await Event.findById(payment.event);

        await Event.findByIdAndUpdate(payment.event, {
          $inc: { [`${ticketField}.sold`]: payment.tickets.length },
          $set: {
            soldOut:
              event.standardTicket.sold +
                (ticketField === "standardTicket"
                  ? payment.tickets.length
                  : 0) >=
                event.standardTicket.quantity &&
              event.vipTicket.sold +
                (ticketField === "vipTicket" ? payment.tickets.length : 0) >=
                event.vipTicket.quantity,
          },
        });

        const updatedPayment = await Payment.findById(payment._id)
          .populate("tickets")
          .populate("event")
          .populate("user", "name email");

        return res.json({
          message: "Wave payment verified successfully",
          payment: updatedPayment,
        });
      } catch (waveError) {
        console.error(
          "Wave verification error:",
          waveError.response?.data || waveError.message
        );

        payment.status = "failed";
        await payment.save();
        await Ticket.updateMany(
          { paymentReference: reference },
          { $set: { status: "failed" } }
        );

        return res.status(500).json({
          message: "Wave payment verification failed",
          error: waveError.message,
          details: waveError.response?.data || undefined,
        });
      }
    } else {
      return res.status(400).json({ message: "Invalid payment gateway" });
    }
  } catch (error) {
    console.error("Payment Verification Error:", error);

    // Error handling and cleanup
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
      details: error.response?.data || undefined,
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
