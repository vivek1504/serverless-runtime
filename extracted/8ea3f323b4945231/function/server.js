const express = require("express");
const serverless = require("serverless-http");

const app = express();

// Middleware
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.json({ message: "Hello from Express inside Firecracker 🚀" });
});

app.post("/echo", (req, res) => {
  res.json({
    you_sent: req.body,
  });
});

// Export Lambda-style handler
module.exports.handler = serverless(app);
