const express = require("express");
const healthRouter = require("./routes/health");
const paymentsRouter = require("./routes/payments");

function createApp() {
  const app = express();
  app.use(express.json());

  app.use("/health", healthRouter);
  app.use("/payments", paymentsRouter);

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "server error" });
  });

  return app;
}

module.exports = { createApp };
