const jwt = require("jsonwebtoken");

/**
 * AUTH_MODE
 * - none   : trust X-Customer-Id (or decode Bearer token) and set req.user.customer_id, NO verify
 * - decode : decode Bearer token only (assume Kong already verified), NO verify
 * - verify : HS256 verify with JWT_SECRET
 */

function pickCustomerId(req) {
  const x = req.headers["x-customer-id"];
  if (x != null && String(x).trim() !== "") return String(x).trim();

  const h = req.headers.authorization || "";
  const [type, token] = h.split(" ");
  if (type === "Bearer" && token) {
    const p = jwt.decode(token);
    if (p && (p.customer_id != null || p.customerId != null)) return String(p.customer_id ?? p.customerId);
    if (p && p.sub != null) return String(p.sub);
  }
  return null;
}

function authMiddleware(req, res, next) {
  const mode = String(process.env.AUTH_MODE || "verify").toLowerCase();

  // common: require some identity input
  if (mode === "none") {
    const cid = pickCustomerId(req);
    if (!cid) return res.status(401).json({ ok: false, error: "NO_CUSTOMER_ID" });
    req.user = { customer_id: Number.isFinite(Number(cid)) ? Number(cid) : cid };
    return next();
  }

  const h = req.headers.authorization || "";
  const [type, token] = h.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ ok: false, error: "NO_TOKEN" });
  }

  if (mode === "decode") {
    const p = jwt.decode(token);
    const cid = p?.customer_id ?? p?.customerId ?? p?.sub;
    if (cid == null) return res.status(401).json({ ok: false, error: "NO_CUSTOMER_ID" });
    req.user = { customer_id: Number.isFinite(Number(cid)) ? Number(cid) : cid, jwt: p };
    return next();
  }

  // verify (HS256)
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ ok: false, error: "JWT_SECRET_MISSING" });

  try {
    const p = jwt.verify(token, secret);
    const cid = p?.customer_id ?? p?.customerId ?? p?.sub;
    if (cid == null) return res.status(401).json({ ok: false, error: "NO_CUSTOMER_ID" });
    req.user = { customer_id: Number.isFinite(Number(cid)) ? Number(cid) : cid, jwt: p };
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
}

module.exports = { authMiddleware };
