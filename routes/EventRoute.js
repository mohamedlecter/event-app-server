// eventRoutes.js
const express = require("express");
const router = express.Router();
const eventController = require("../controllers/event");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const upload = require("../config/multerConfig");

// Public routes
router.get("/", eventController.getAllEvents);
router.get("/:id", eventController.getEventById);

// Protected routes (require authentication)
router.post(
  "/events",
  authMiddleware,
  adminMiddleware,
  upload.single("photo"), // Use Multer to handle file uploads
  eventController.createEvent
);

router.put(
  "/event/:id",
  authMiddleware,
  upload.single("photo"), // Use Multer to handle file uploads
  eventController.updateEvent
);

router.delete("/events/:id", authMiddleware, eventController.deleteEvent);

router.get("/events/:id/attendees", eventController.getEventAttendees);
router.get("/getMyEvents", authMiddleware, eventController.getMyEvents);

module.exports = router;
