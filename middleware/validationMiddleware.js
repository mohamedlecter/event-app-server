const validationService = require('../services/validationService');

const validateEvent = (req, res, next) => {
  const { error } = validationService.validateEventInput(req.body);
  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }
  next();
};

const validatePayment = (req, res, next) => {
  const { error } = validationService.validatePaymentInput(req.body);
  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }
  next();
};

const validateTransfer = (req, res, next) => {
  const { error } = validationService.validateTransferInput(req.body);
  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }
  next();
};

module.exports = {
  validateEvent,
  validatePayment,
  validateTransfer,
}; 