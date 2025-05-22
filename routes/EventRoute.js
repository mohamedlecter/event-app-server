const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController.js');
const authMiddleware = require('../middleware/authMiddleware.js');
const adminMiddleware = require('../middleware/adminMiddleware.js');
const { validateEvent, validatePayment, validateTransfer } = require('../middleware/validationMiddleware.js');
const upload = require('../config/multer');

// Public routes (no authentication required)
router.get('/', eventController.getAllEvents);
router.get('/:id', eventController.getEventDetails);

// Protected routes (require authentication)
router.use(authMiddleware);

// User routes
router.post('/:eventId/pay', validatePayment, eventController.initiatePayment);
router.post('/verify-payment', eventController.verifyPayment);
router.get('/user/tickets', eventController.getUserTickets);

// Ticket transfer routes
router.put('/tickets/:ticketId/transfer', validateTransfer, eventController.transferTicket);
router.get('/tickets/:ticketId/transfer-history', eventController.getTransferHistory);
router.post('/tickets/:ticketId/cancel-transfer', eventController.cancelTransfer);
router.post('/tickets/notify-transfer', eventController.sendTransferNotification);

// Admin routes (require admin privileges)
router.use(adminMiddleware);
router.post('/', upload.single('image'), validateEvent, eventController.createEvent);
router.put('/:id', upload.single('image'), validateEvent, eventController.updateEvent);
router.delete('/:id', eventController.deleteEvent);

module.exports = router; 