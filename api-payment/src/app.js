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

// ✅ morgan은 부하 테스트 때 로그 폭증 유발 가능 → ENV로 제어 권장
if ((process.env.MORGAN_ENABLED || "0") === "1") {
  app.use(morgan("dev"));
}

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

// ✅ access log (요청 1건당 1줄 JSON)
// - 라우트들보다 "위"에 있어야 정상적으로 전 요청에 적용됨
// - 부하 테스트 때는 SAMPLE_RATE / SLOW_MS로 로그량 제어
app.use((req, res, next) => {
  const enabled = (process.env.ACCESS_LOG_ENABLED || "0") === "1";
  if (!enabled) return next();

  // (선택) health/metrics/options는 보통 제외
  const skipHealth = (process.env.ACCESS_LOG_SKIP_HEALTH || "1") === "1";
  if (skipHealth && (req.originalUrl === "/health" || req.originalUrl.startsWith("/health/"))) {
    return next();
  }
  if (req.method === "OPTIONS") return next();

  const slowMs = Number(process.env.ACCESS_LOG_SLOW_MS || "0"); // 0이면 전부 찍힘
  const rate = Number(process.env.ACCESS_LOG_SAMPLE_RATE || "1"); // 1이면 100%
  const shouldSample = !(rate < 1) || Math.random() < rate;

  const t0 = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    // 샘플링/슬로우컷
    if (!shouldSample) return;
    if (Number.isFinite(slowMs) && ms < slowMs) return;

    console.log(
      JSON.stringify({
        tag: "access",
        service: process.env.SERVICE_NAME || "api-payment",
        rid: req.reqId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        dur_ms: Number(ms.toFixed(3)),
      })
    );
  });

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

