const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController.js");
const authMiddleware = require("../middleware/authMiddleware.js");
const adminMiddleware = require("../middleware/adminMiddleware.js");

// All routes require admin authentication
router.use(authMiddleware);
router.use(adminMiddleware);

// Dashboard stats
router.get("/dashboard", adminController.getDashboardStats);

// Events
router.get("/events", adminController.fetchAdminEvents);

// Payments
router.get("/payments", adminController.getAllPayments);

// Tickets
router.get("/tickets/:referenceId", adminController.searchTickets);
router.put("/tickets/:ticketId/scan", adminController.scanTicket);

// Event analytics
router.get("/events/:eventId/analytics", adminController.getEventAnalytics);

module.exports = router;
