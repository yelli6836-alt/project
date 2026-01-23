const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const health = require("./routes/health");
const payments = require("./routes/payments");

const app = express();

/**
 * CORS (브라우저 직행 계약)
 * - demo에서는 일단 널널하게(Origin reflect) 가고,
 * - 필요하면 CORS_ORIGINS로 제한 가능
 */
const corsOptions = {
  origin: (origin, cb) => {
    const allow = String(process.env.CORS_ORIGINS || "").trim();
    if (!allow) return cb(null, true); // demo: origin 제한 없음(반사)
    const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
    if (!origin) return cb(null, true); // curl/k6 등
    return cb(null, list.includes(origin));
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-User-Id",
    "X-Customer-Id",
    "X-Request-Id",
  ],
  exposedHeaders: ["X-Request-Id", "X-User-Id"],
  maxAge: 86400,
  credentials: false,
};

app.use(helmet());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // ✅ preflight 처리
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// Request ID (k6의 X-Request-Id와 연동 / 없으면 생성)
// - req.reqId에 저장
// - 응답 헤더 X-Request-Id로도 내려줌
app.use((req, res, next) => {
  const incoming = req.get("X-Request-Id");
  const rid =
    (incoming && String(incoming).trim()) ||
    (crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

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

