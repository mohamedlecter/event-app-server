const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController.js");
const authMiddleware = require("../middleware/authMiddleware.js");

// Register a new user
router.post("/register", authController.register);

// Login user
router.post("/login", authController.login);

router.get("/me", authMiddleware, authController.getCurrentUser);

module.exports = router;
