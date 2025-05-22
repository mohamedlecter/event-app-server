const stripe = require("stripe");

let stripeClient = null;

const initializeStripe = () => {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe API key is not configured. Please check your environment variables.');
    }
    stripeClient = stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-08-16",
    });
  }
  return stripeClient;
};

const waveConfig = {
  apiKey: process.env.WAVE_API_KEY,
  apiUrl: "https://api.wave.com/v1",
};

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

const createStripeSession = async (event, ticketType, quantity, mainReference, ticketReferences, metadata) => {
  const stripeClient = initializeStripe();
  const ticketField = ticketType === "vip" ? "vipTicket" : "standardTicket";
  const amount = event[ticketField].price * quantity;

  // Ensure all metadata values are strings
  const stripeMetadata = {
    eventId: event._id.toString(),
    eventTitle: event.title,
    ticketType,
    quantity: quantity.toString(),
    ticketReferences: JSON.stringify(ticketReferences),
    ...Object.fromEntries(
      Object.entries(metadata || {}).map(([key, value]) => [key, String(value)])
    )
  };

  return await stripeClient.checkout.sessions.create({
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
    success_url: `http://3.107.8.204/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `http://3.107.8.204/events/${event._id}`,
    client_reference_id: mainReference,
    metadata: stripeMetadata,
  });
};

const verifyStripePayment = async (session) => {
  const stripeClient = initializeStripe();
  const paymentReference = session.client_reference_id;
  const payment = await Payment.findOne({ reference: paymentReference })
    .populate("tickets")
    .populate("event")
    .populate("user", "name email");

  if (!payment) {
    throw new Error("Payment not found");
  }

  if (session.payment_status !== "paid") {
    await Payment.findOneAndUpdate(
      { reference: paymentReference },
      { $set: { status: "failed" } }
    );

    await Ticket.updateMany(
      { paymentReference: paymentReference },
      { $set: { status: "failed" } }
    );

    throw new Error("Payment failed");
  }

  return { payment, session };
};

const verifyWavePayment = async (reference) => {
  const payment = await Payment.findOne({ reference })
    .populate("tickets")
    .populate("event")
    .populate("user", "name email");

  if (!payment) {
    throw new Error("Payment not found");
  }

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

  if (waveData.status !== "completed" && waveData.payment_status !== "paid") {
    throw new Error("Wave payment not completed");
  }

  return { payment, waveData };
};

module.exports = {
  createWaveCheckout,
  createStripeSession,
  verifyStripePayment,
  verifyWavePayment,
}; 