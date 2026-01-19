const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const health = require("./routes/health");
const delivery = require("./routes/delivery");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.use("/health", health);
app.use("/delivery", delivery);

app.use((req, res) => res.status(404).json({ ok: false, error: "NOT_FOUND" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "INTERNAL_ERROR", message: err.message });
});

module.exports = { app };
