const express = require("express");
const crypto = require("crypto");
const health = require("./routes/health");
const payments = require("./routes/payments");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Request ID (k6의 X-Request-Id와 연동 / 없으면 생성)
// - req.reqId에 저장
// - 응답 헤더 X-Request-Id로도 내려줌
app.use((req, res, next) => {
  const incoming = req.get("X-Request-Id");
  const rid =
    (incoming && String(incoming).trim()) ||
    (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  req.reqId = rid;
  res.setHeader("X-Request-Id", rid);
  next();
});

app.use("/health", health);
app.use("/", payments);

app.use((req, res) => res.status(404).json({ ok: false, error: "NOT_FOUND" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "INTERNAL_ERROR", message: err.message });
});

module.exports = { app };

