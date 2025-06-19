const Ticket = require("../Models/Ticket");
const Payment = require("../Models/Payments");
const axios = require("axios");
const { createLogger, format, transports } = require("winston");
const dotenv = require("dotenv");

// Configure logger
const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.File({ filename: "logs/payment-error.log", level: "error" }),
    new transports.File({ filename: "logs/payment.log" }),
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    })
  ]
});

// Constants
const PAYMENT_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  REFUNDED: "refunded"
};
dotenv.config();


// Initialize Stripe client
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Wave configuration
const waveConfig = {
  apiKey: process.env.WAVE_API_KEY,
  apiUrl: "https://api.wave.com/v1",
  timeout: 10000,
};

// Validate payment amount
const validatePaymentAmount = (amount, currency) => {
  if (amount <= 0) {
    throw new Error("Invalid payment amount");
  }
  if (!["XOF", "GMD", "USD", "EUR"].includes(currency.toUpperCase())) {
    throw new Error("Unsupported currency");
  }
};

// Create Wave payout
const createWaveCheckout = async (amount, currency, reference, callbackUrl) => {
  try {
    logger.info("Creating Wave checkout session", { amount, currency, reference });
    
    validatePaymentAmount(amount, currency);

    const response = await axios.post(
      `${waveConfig.apiUrl}/checkout/sessions`,
      {
        amount: amount.toString(),
        currency: currency.toUpperCase(),
        client_reference: reference,
        success_url: callbackUrl,
        error_url: `${process.env.FRONTEND_URL}/payment-error?reference=${reference}`,
      },
      {
        headers: {
          Authorization: `Bearer ${waveConfig.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": reference,
        },
        timeout: waveConfig.timeout,
      }
    );

    // Store the session ID in the payment record
    await Payment.findOneAndUpdate(
      { reference },
      { 
        waveSessionId: response.data.id,
        status: PAYMENT_STATUS.PENDING,
        wavePaymentId: response.data.id
      }
    );

    logger.info("Wave checkout session created successfully", { reference });
    logger.info("Wave response data", response.data);

    return {
      id: response.data.id,
      payment_url: response.data.wave_launch_url,
      url: response.data.wave_launch_url
    };
  } catch (error) {
    logger.error("Wave checkout session creation failed", {
      error: error.message,
      reference,
      response: error.response?.data,
    });
    throw new Error("Failed to create Wave checkout session");
  }
};

// Create Stripe session
const createStripeSession = async (event, ticketType, quantity, mainReference, ticketReferences, metadata) => {
  try {
    logger.info("Creating Stripe checkout session", {
      eventId: event._id,
      ticketType,
      quantity,
      reference: mainReference,
    });

    const ticketField = ticketType === "vip" ? "vipTicket" : "standardTicket";
    const amount = event[ticketField].price * quantity;

    // Enhanced metadata with additional information
    const stripeMetadata = {
      eventId: event._id.toString(),
      eventTitle: event.title,
      ticketType,
      quantity: quantity.toString(),
      ticketReferences: JSON.stringify(ticketReferences),
      timestamp: new Date().toISOString(),
      ...Object.fromEntries(
        Object.entries(metadata || {}).map(([key, value]) => [key, String(value)])
      ),
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "gmd",
            product_data: {
              name: `${event.title} - ${ticketType} Ticket`,
              description: `Purchase of ${quantity} ${ticketType} ticket(s) for ${event.title}`,
              metadata: {
                eventId: event._id.toString(),
                ticketType,
              },
            },
            unit_amount: amount * 100,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/events/${event._id}`,
      client_reference_id: mainReference,
      metadata: stripeMetadata,
      payment_intent_data: {
        metadata: stripeMetadata,
      },
    });

    logger.info("Stripe checkout session created successfully", {
      sessionId: session.id,
      reference: mainReference,
    });

    return session;
  } catch (error) {
    logger.error("Stripe session creation failed", {
      error: error.message,
      reference: mainReference,
    });
    throw new Error("Failed to create Stripe checkout session");
  }
};

// Verify Stripe payment
const verifyStripePayment = async (session) => {
  try {
    logger.info("Verifying Stripe payment", { sessionId: session.id });

    const paymentReference = session.client_reference_id;
    const payment = await Payment.findOne({ reference: paymentReference })
      .populate("tickets")
      .populate("event")
      .populate("user", "name email");

    if (!payment) {
      throw new Error("Payment not found");
    }

    // Verify session status
    const sessionStatus = await stripe.checkout.sessions.retrieve(session.id);

    if (sessionStatus.payment_status !== "paid") {
      await updatePaymentStatus(paymentReference, PAYMENT_STATUS.FAILED);
      throw new Error("Payment failed");
    }

    // Update payment status
    await updatePaymentStatus(paymentReference, PAYMENT_STATUS.COMPLETED);

    logger.info("Stripe payment verified successfully", {
      sessionId: session.id,
      reference: paymentReference,
    });

    return { payment, session: sessionStatus };
  } catch (error) {
    logger.error("Stripe payment verification failed", {
      error: error.message,
      sessionId: session.id,
    });
    throw new Error("Payment verification failed");
  }
};

// Verify Wave payment
const verifyWavePayment = async (reference) => {
  try {
    logger.info("Verifying Wave payment", { reference });

    const payment = await Payment.findOne({ reference })
      .populate("tickets")
      .populate("event")
      .populate("user", "name email");

    if (!payment) {
      throw new Error("Payment not found");
    }

    // If payment is already completed, return it
    if (payment.status === PAYMENT_STATUS.COMPLETED) {
      return { payment, waveData: { status: "succeeded" } };
    }

    // If payment is pending, check with Wave
    if (payment.status === PAYMENT_STATUS.PENDING) {
      try {
        const waveResponse = await axios.get(
          `${waveConfig.apiUrl}/checkout/sessions/${payment.waveSessionId}`,
          {
            headers: {
              Authorization: `Bearer ${waveConfig.apiKey}`,
              "Content-Type": "application/json",
            },
            timeout: waveConfig.timeout,
          }
        );

        const waveData = waveResponse.data;
        logger.info("Wave payment status check", { waveData });

        // Handle different payment statuses
        if (waveData.payment_status === "succeeded" || waveData.checkout_status === "completed") {
          await updatePaymentStatus(reference, PAYMENT_STATUS.COMPLETED);
          return { 
            payment, 
            waveData: {
              id: waveData.id,
              status: "succeeded",
              payment_status: waveData.payment_status,
              checkout_status: waveData.checkout_status
            }
          };
        } else if (["failed", "cancelled", "expired"].includes(waveData.payment_status)) {
          await updatePaymentStatus(reference, PAYMENT_STATUS.FAILED);
          throw new Error("Payment failed or was cancelled");
        } else {
          // Payment is still pending
          return { 
            payment, 
            waveData: {
              id: waveData.id,
              status: "pending",
              payment_status: waveData.payment_status,
              checkout_status: waveData.checkout_status,
              wave_launch_url: waveData.wave_launch_url
            },
            message: "Payment is still pending. Please complete the payment on Wave's platform."
          };
        }
      } catch (error) {
        if (error.response?.status === 404) {
          // Session not found or not yet created on Wave's side
          return {
            payment,
            message: "Payment session not found. Please initiate the payment first."
          };
        }
        throw error;
      }
    }

    // If payment is failed
    if (payment.status === PAYMENT_STATUS.FAILED) {
      throw new Error("Payment has failed");
    }

    return { payment };
  } catch (error) {
    logger.error("Wave payment verification failed", {
      error: error.message,
      reference,
    });
    throw new Error("Payment verification failed");
  }
};

// Helper function to update payment status
const updatePaymentStatus = async (reference, status) => {
  try {
    await Payment.findOneAndUpdate(
      { reference },
      { 
        $set: { 
          status,
          updatedAt: new Date(),
          lastStatusCheck: new Date()
        }
      }
    );

    if (status === PAYMENT_STATUS.FAILED) {
      await Ticket.updateMany(
        { paymentReference: reference },
        { 
          $set: { 
            status: "failed",
            updatedAt: new Date()
          }
        }
      );
    }

    logger.info("Payment status updated", { reference, status });
  } catch (error) {
    logger.error("Failed to update payment status", {
      error: error.message,
      reference,
      status,
    });
    throw new Error("Failed to update payment status");
  }
};

module.exports = {
  createWaveCheckout,
  createStripeSession,
  verifyStripePayment,
  verifyWavePayment,
  PAYMENT_STATUS,
}; 