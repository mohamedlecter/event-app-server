const Joi = require('joi');

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidMobile = (mobile) => {
  const mobileRegex = /^\+?[\d\s-]{10,}$/;
  return mobileRegex.test(mobile);
};

const validateEventInput = (data) => {
  const schema = Joi.object({
    title: Joi.string().required().min(3).max(100),
    description: Joi.string().required().min(10),
    country: Joi.string().required(),
    city: Joi.string().required(),
    standardPrice: Joi.number().required().min(0),
    standardQuantity: Joi.number().required().min(1),
    vipPrice: Joi.number().required().min(0),
    vipQuantity: Joi.number().required().min(1),
    date: Joi.date().required().min('now'),
    category: Joi.string().required(),
  });

  return schema.validate(data);
};

const validatePaymentInput = (data) => {
  const schema = Joi.object({
    ticketType: Joi.string().valid('standard', 'vip').required(),
    quantity: Joi.number().required().min(1),
    recipientType: Joi.string().valid('email', 'mobile').required(),
    recipientInfo: Joi.array().items(
      Joi.object({
        type: Joi.string().valid('email', 'mobile').required(),
        value: Joi.string().required(),
        name: Joi.string()
      })
    ).required(),
    paymentGateway: Joi.string().valid('stripe', 'wave').default('stripe'),
    currency: Joi.string().valid('USD', 'XOF', 'GMD').default('GMD'),
    metadata: Joi.object({
      eventId: Joi.string().required(),
      eventTitle: Joi.string(),
      ticketType: Joi.string(),
      quantity: Joi.string()
    })
  });

  return schema.validate(data);
};

const validateTransferInput = (data) => {
  const schema = Joi.object({
    recipientType: Joi.string().valid('mobile', 'email').required(),
    recipientValue: Joi.string().required(),
    recipientName: Joi.string().required(),
  });

  return schema.validate(data);
};

const validateEnvironmentVariables = () => {
  const schema = Joi.object({
    PORT: Joi.number().default(4000),
    MONGO_URI: Joi.string().required(),
    NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
    FRONTEND_URL: Joi.string().required(),
    STRIPE_SECRET_KEY: Joi.string().required(),
    WAVE_API_KEY: Joi.string().required(),
  }).unknown();

  return schema.validate(process.env);
};

module.exports = {
  isValidEmail,
  isValidMobile,
  validateEventInput,
  validatePaymentInput,
  validateTransferInput,
  validateEnvironmentVariables,
}; 