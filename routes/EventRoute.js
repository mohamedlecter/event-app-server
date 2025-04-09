const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController.js');
const authMiddleware = require('../middleware/authMiddleware.js');
const adminMiddleware = require('../middleware/adminMiddleware.js');
const upload = require('../config/multer');

// Public routes (no authentication required)
router.get('/', eventController.getAllEvents);
router.get('/:id', eventController.getEventDetails);

// Protected routes (require authentication)
router.use(authMiddleware);

// User routes
router.post('/:eventId/pay', eventController.initiatePayment);
router.post('/verify-payment', eventController.verifyPayment);
router.get('/user/tickets', eventController.getUserTickets);
router.put('/tickets/:ticketId/transfer', eventController.transferTicket);

// Admin routes (require admin privileges)
router.use(adminMiddleware);
router.post('/', upload.single('image'), eventController.createEvent);
router.put('/:id', upload.single('image'), eventController.updateEvent);
router.delete('/:id', eventController.deleteEvent);

module.exports = router;