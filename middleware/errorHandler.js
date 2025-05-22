const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  // Handle specific error types
  if (err.name === "ValidationError") {
    return res.status(400).json({
      message: "Validation Error",
      errors: err.errors
    });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({
      message: "Unauthorized Access"
    });
  }

  if (err.name === "NotFoundError") {
    return res.status(404).json({
      message: err.message || "Resource not found"
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    message: err.message || "Something broke!",
    error: process.env.NODE_ENV === "development" ? err : {}
  });
};

module.exports = errorHandler; 