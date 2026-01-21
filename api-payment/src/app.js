const express = require("express");
const health = require("./routes/health");
const payments = require("./routes/payments");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/health", health);
app.use("/payments", payments);

app.use((req, res) => res.status(404).json({ ok: false, error: "NOT_FOUND" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "INTERNAL_ERROR", message: err.message });
});

module.exports = { app };
