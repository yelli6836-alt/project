const jwt = require("jsonwebtoken");

// demo/trust mode: AUTH_DISABLED=true OR AUTH_MODE=trust
function isTrustMode() {
  return (
    String(process.env.AUTH_DISABLED || "").toLowerCase() === "true" ||
    String(process.env.AUTH_MODE || "").toLowerCase() === "trust"
  );
}

function trustUserFromHeader(req) {
  const raw = req.get("X-Customer-Id");
  const id = Number(raw);
  req.user = req.user || {};
  req.user.customer_id = Number.isFinite(id) && id > 0 ? id : 1; // default 1
  return req.user;
}

function authMiddleware(req, res, next) {
  if (isTrustMode()) {
    trustUserFromHeader(req);
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
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
}

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
