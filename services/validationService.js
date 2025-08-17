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
  const ticketTypeSchema = Joi.object({
    name: Joi.string().required().min(1).max(50),
    price: Joi.number().required().min(0),
    currency: Joi.string().valid('USD', 'XOF', 'GMD', 'EUR', 'GBP').default('GMD'),
    quantity: Joi.number().required().min(1),
    description: Joi.string().optional().max(200),
    benefits: Joi.array().items(Joi.string()).optional()
  });

  const schema = Joi.object({
    title: Joi.string().required().min(3).max(100),
    description: Joi.string().optional().min(10),
    country: Joi.string().required(),
    city: Joi.string().required(),
    ticketTypes: Joi.array().items(ticketTypeSchema).required().min(1),
    date: Joi.date().required().min('now'),
    category: Joi.string().required(),
  });

  return schema.validate(data);
};

const validatePaymentInput = (data) => {
  const schema = Joi.object({
    ticketTypeName: Joi.string().required(),
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