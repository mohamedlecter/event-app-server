// eventRoutes.js
const express = require("express");
const router = express.Router();
const eventController = require("../controllers/event");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const upload = require("../config/multerConfig");

// Public routes
router.get("/", eventController.getAllEvents);
router.get("/getMyEvents", authMiddleware, eventController.getMyEvents);
router.get(
  "/MyPurchasedEvents",
  authMiddleware,
  eventController.getMyPurchasedEvents
);
router.get("/:id", eventController.getEventById);

// Protected routes (require authentication)
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  upload.single("photo"), // Use Multer to handle file uploads
  eventController.createEvent
);

router.put(
  "/:id",
  authMiddleware,
  upload.single("photo"), // Use Multer to handle file uploads
  eventController.updateEvent
);

router.delete("/:id", authMiddleware, eventController.deleteEvent);

router.get("/:id/attendees", eventController.getEventAttendees);

router.post("/:eventId/pay", authMiddleware, eventController.initiatePayment);

// Update existing attendee route
router.put("/:eventId/attend", authMiddleware, eventController.attendEvent);
router.post("/payment/verify", eventController.verifyPayment);

module.exports = router;
