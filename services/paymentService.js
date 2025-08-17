/**
 * Payment Service
 * 
 * Supports multiple currencies and payment gateways:
 * 
 * Wave Payment Gateway:
 * - Supports: GMD (Gambian Dalasi) only
 * - Other currencies are automatically converted to GMD
 * 
 * Stripe Payment Gateway:
 * - Supports: USD, EUR, GBP directly
 * - GMD and XOF are converted to USD for processing
 * - Real-time exchange rates from exchangerate-api.com
 * 
 * Currency Conversion:
 * - All conversions go through USD as base currency
 * - Exchange rates are cached and updated regularly
 * - Fallback rates provided if API is unavailable
 */

const Ticket = require("../Models/Ticket");
const Payment = require("../Models/Payments");
const axios = require("axios");
const { createLogger, format, transports } = require("winston");
const dotenv = require("dotenv");
const events = require("node:events");

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
  SUCCESS: "success",
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
  if (!["XOF", "GMD", "USD", "EUR", "GBP"].includes(currency.toUpperCase())) {
    throw new Error("Unsupported currency");
  }
};

// Get exchange rates for currency conversion
const getExchangeRates = async () => {
  try {
    const response = await axios.get('https://v6.exchangerate-api.com/v6/0c3c3f2278d7441022708f1d/latest/USD');
    const rates = response.data.conversion_rates;
    
    return {
      USD: 1,
      EUR: rates.EUR || 0.85,
      GBP: rates.GBP || 0.73,
      GMD: rates.GMD || 58.5,
      XOF: rates.XOF || 550
    };
  } catch (error) {
    logger.error("Failed to fetch exchange rates", { error: error.message });
    // Fallback rates if API fails
    return {
      USD: 1,
      EUR: 0.85,
      GBP: 0.73,
      GMD: 58.5,
      XOF: 550
    };
  }
};

// Convert amount from one currency to another
const convertCurrency = async (amount, fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) {
    return { amount, rate: 1 };
  }

  const rates = await getExchangeRates();
  
  // Validate currencies exist in rates
  if (!rates[fromCurrency] || !rates[toCurrency]) {
    throw new Error(`Unsupported currency conversion: ${fromCurrency} to ${toCurrency}`);
  }
  
  // Convert to USD first, then to target currency
  const usdAmount = amount / rates[fromCurrency];
  const convertedAmount = usdAmount * rates[toCurrency];
  
  return {
    amount: Math.round(convertedAmount * 100) / 100, // Round to 2 decimal places
    rate: rates[toCurrency] / rates[fromCurrency]
  };
};

// Create Wave payout
const createWaveCheckout = async (amount, currency, reference, callbackUrl) => {
  try {
    logger.info("Creating Wave checkout session", { amount, currency, reference });
    
    validatePaymentAmount(amount, currency);

    // Wave only supports GMD, so convert if needed
    let waveAmount = amount;
    let exchangeRate = 1;
    
    if (currency !== "GMD") {
      const conversion = await convertCurrency(amount, currency, "GMD");
      waveAmount = conversion.amount;
      exchangeRate = conversion.rate;
    }

    const response = await axios.post(
      `${waveConfig.apiUrl}/checkout/sessions`,
      {
        amount: waveAmount.toString(),
        currency: "GMD",
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

    // Store the session ID and conversion info in the payment record
    await Payment.findOneAndUpdate(
      { reference },
      { 
        waveSessionId: response.data.id,
        status: PAYMENT_STATUS.PENDING,
        wavePaymentId: response.data.id,
        amount: waveAmount,
        currency: "GMD",
        exchangeRate: exchangeRate
      }
    );

    logger.info("Wave checkout session created successfully", { reference });
    logger.info("Wave response data", response.data);

    return {
      id: response.data.id,
      payment_url: response.data.wave_launch_url,
      url: response.data.wave_launch_url,
      convertedAmount: waveAmount,
      originalAmount: amount,
      originalCurrency: currency,
      exchangeRate: exchangeRate
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
const createStripeSession = async (event, ticketTypeName, quantity, mainReference, ticketReferences, metadata, currency = "USD") => {
  try {
    logger.info("Creating Stripe checkout session", {
      eventId: event._id,
      ticketTypeName,
      quantity,
      reference: mainReference,
      currency,
    });

    // Find the ticket type from the event
    const ticketType = event.getTicketTypeByName(ticketTypeName);
    if (!ticketType) {
      throw new Error(`Ticket type "${ticketTypeName}" not found`);
    }

    let originalAmount = ticketType.price * quantity;
    let stripeAmount = originalAmount;
    let exchangeRate = 1;

    // Convert to Stripe-supported currency if needed
    if (currency === "GMD") {
      // Convert GMD to USD for Stripe
      const conversion = await convertCurrency(originalAmount, "GMD", "USD");
      stripeAmount = conversion.amount;
      exchangeRate = conversion.rate;
    } else if (currency === "EUR") {
      // Stripe supports EUR directly
      stripeAmount = originalAmount;
    } else if (currency === "GBP") {
      // Stripe supports GBP directly
      stripeAmount = originalAmount;
    } else {
      // Default to USD
      if (currency !== "USD") {
        const conversion = await convertCurrency(originalAmount, currency, "USD");
        stripeAmount = conversion.amount;
        exchangeRate = conversion.rate;
      }
    }

    // Enhanced metadata with additional information
    const stripeMetadata = {
      eventId: event._id.toString(),
      eventTitle: event.title,
      ticketType: ticketTypeName,
      quantity: quantity.toString(),
      ticketReferences: JSON.stringify(ticketReferences),
      originalAmount: originalAmount.toString(),
      originalCurrency: currency,
      exchangeRate: exchangeRate.toString(),
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
            currency: currency === "GMD" ? "usd" : currency.toLowerCase(),
            product_data: {
              name: `${event.title} - ${ticketTypeName} Ticket`,
              description: `Purchase of ${quantity} ${ticketTypeName} ticket(s) for ${event.title}`,
              metadata: {
                eventId: event._id.toString(),
                ticketType: ticketTypeName,
              },
            },
            unit_amount: Math.round(stripeAmount * 100),
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

    // Update payment record with conversion info
    await Payment.findOneAndUpdate(
      { reference: mainReference },
      {
        amount: stripeAmount,
        currency: currency === "GMD" || currency === "XOF" ? "USD" : currency,
        originalAmount: originalAmount,
        originalCurrency: currency,
        exchangeRate: exchangeRate
      }
    );

    logger.info("Stripe checkout session created successfully", {
      sessionId: session.id,
      reference: mainReference,
      originalAmount,
      stripeAmount,
      currency,
    });

    return {
      ...session,
      originalAmount,
      convertedAmount: stripeAmount,
      exchangeRate
    };
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
    await updatePaymentStatus(paymentReference, PAYMENT_STATUS.SUCCESS);


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

    // If payment is already SUCCESS, return it
    if (payment.status === PAYMENT_STATUS.SUCCESS) {
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
          await updatePaymentStatus(reference, PAYMENT_STATUS.SUCCESS);
          // Fetch updated payment
          const updatedPayment = await Payment.findOne({ reference })
            .populate("tickets")
            .populate("event")
            .populate("user", "name email");
          return {
            payment: updatedPayment,
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
  convertCurrency,
  getExchangeRates,
  PAYMENT_STATUS,
};