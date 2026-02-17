const jwt = require("jsonwebtoken");

// demo/trust mode: AUTH_DISABLED=true OR AUTH_MODE=trust
function isTrustMode() {
  return (
    String(process.env.AUTH_DISABLED || "").toLowerCase() === "true" ||
    String(process.env.AUTH_MODE || "").toLowerCase() === "trust"
  );
}

function parsePositiveInt(v) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function trustUserFromHeader(req, res) {
  // 공식: X-User-Id
  // 호환: X-Customer-Id
  const raw = req.get("X-User-Id") || req.get("X-Customer-Id");
  const id = parsePositiveInt(raw) || parsePositiveInt(process.env.DEMO_DEFAULT_CUSTOMER_ID) || 1;

  req.user = req.user || {};
  req.user.customer_id = id;

  // (선택) 디버깅/가시성: 응답에도 공식 헤더로 되돌려줌
  if (res && typeof res.setHeader === "function") {
    res.setHeader("X-User-Id", String(id));
  }

  return req.user;
}

function authMiddleware(req, res, next) {
  if (isTrustMode()) {
    trustUserFromHeader(req, res);
    return next();
  }

  const h = req.headers.authorization || "";
  const [type, token] = h.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ ok: false, error: "NO_TOKEN" });
  }

  const secret = process.env.JWT_SECRET || "ChangeMe_SuperSecret";
  try {
    const payload = jwt.verify(token, secret);
    req.user = payload || {};
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
}

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;

