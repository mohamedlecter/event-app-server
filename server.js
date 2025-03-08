const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const bodyParser = require("body-parser");
const EventRoute = require("./routes/EventRoute");
const UserRoute = require("./routes/UserRoute");

dotenv.config();

const app = express();
const PORT = process.env.PORT;

// Middleware
// CORS Configuration
const allowedOrigins = [
  "http://localhost:4000", // Frontend URL (adjust port if needed)
  "http://10.0.2.2:4000", // Additional origin (if applicable)
];

app.use(cors());

// Middleware
app.use(bodyParser.json());

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Connect to MongoDB
mongoose.Promise = global.Promise;
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB Connection Error:", err));

// Routes
app.use("/api/user", UserRoute);
app.use("/api/events", EventRoute);

app.get("/", (req, res) => {
  res.json({
    message: "Hello Crud Node Express",
  });
});
// Start Server

app.listen(PORT || 4000, () => {
  console.log(`Server is listening on port ${process.env.PORT || 4000}`);
});
