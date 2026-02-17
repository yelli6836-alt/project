const router = require("express").Router();
const axios = require("axios");
const asyncWrap = require("../utils/asyncWrap");
const { authMiddleware } = require("../utils/authMiddleware");
const { services, http } = require("../config");

const client = axios.create({ timeout: http.timeoutMs });

function pickUserId(req) {
  return (
    (req.user && req.user.customer_id) ||
    Number(req.get("X-User-Id")) ||
    Number(req.get("X-Customer-Id")) ||
    Number(process.env.DEMO_DEFAULT_CUSTOMER_ID) ||
    1
  );
}

function forwardHeaders(req) {
  const headers = {};
  const userId = pickUserId(req);
  if (userId) headers["X-User-Id"] = String(userId);

  const auth = req.headers.authorization;
  if (auth) headers["Authorization"] = auth;

  const rid = req.get("X-Request-Id");
  if (rid) headers["X-Request-Id"] = rid;

  return headers;
}

function moneyToCents(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return NaN;
  const whole = Number(m[1]);
  const frac = Number((m[2] || "0").padEnd(2, "0"));
  return whole * 100 + frac;
}

function summarizeCart(items) {
  const arr = Array.isArray(items) ? items : [];
  let totalQty = 0;
  let totalCents = 0;
  for (const it of arr) {
    const qty = Number(it.qty) || 0;
    totalQty += qty;
    const cents = moneyToCents(it.price_snapshot);
    if (Number.isFinite(cents)) totalCents += cents * qty;
  }
  return {
    item_count: arr.length,
    total_qty: totalQty,
    total_cents: totalCents,
    total_amount: (totalCents / 100).toFixed(2),
  };
}

function upstreamError(res, err, label) {
  if (err.response) {
    return res.status(err.response.status).json({
      ok: false,
      error: `UPSTREAM_${label}_ERROR`,
      upstream: err.response.data,
    });
  }
  return res.status(502).json({ ok: false, error: `UPSTREAM_${label}_UNREACHABLE`, message: err.message });
}

/**
 * Public: products list/detail
 * (No auth required in product API, but safe to accept headers)
 */

// GET /ui/products?category_id=&q=&page=&size=&status=
router.get("/products", asyncWrap(async (req, res) => {
  try {
    const r = await client.get(`${services.product}/products`, {
      params: req.query,
      headers: forwardHeaders(req),
    });
    return res.status(r.status).json(r.data);
  } catch (e) {
    return upstreamError(res, e, "PRODUCT");
  }
}));

// GET /ui/product/:itemId  (includes images if available)
router.get(["/product/:itemId", "/products/:itemId"], asyncWrap(async (req, res) => {
  const itemId = String(req.params.itemId || "").trim();
  try {
    const itemRes = await client.get(`${services.product}/products/${encodeURIComponent(itemId)}`, {
      headers: forwardHeaders(req),
    });

    let images = [];
    try {
      const imgRes = await client.get(`${services.product}/products/${encodeURIComponent(itemId)}/images`, {
        headers: forwardHeaders(req),
      });
      images = Array.isArray(imgRes?.data?.images) ? imgRes.data.images : (Array.isArray(imgRes?.data?.items) ? imgRes.data.items : []);
    } catch {
      // images are optional
    }

    const data = itemRes.data || {};
    return res.status(itemRes.status).json({
      ...data,
      images,
    });
  } catch (e) {
    return upstreamError(res, e, "PRODUCT");
  }
}));

/**
 * Auth required: cart/checkout/order-detail
 */

// GET /ui/cart
router.get("/cart", authMiddleware, asyncWrap(async (req, res) => {
  try {
    const r = await client.get(`${services.cart}/cart`, {
      headers: forwardHeaders(req),
    });
    const cart = r?.data?.cart;
    const items = Array.isArray(r?.data?.items) ? r.data.items : [];
    const summary = summarizeCart(items);

    return res.status(r.status).json({ ok: true, cart, items, summary });
  } catch (e) {
    return upstreamError(res, e, "CART");
  }
}));

// POST /ui/checkout  (proxy to api-order POST /orders/from-cart)
router.post("/checkout", authMiddleware, asyncWrap(async (req, res) => {
  try {
    const r = await client.post(`${services.order}/orders/from-cart`, req.body || {}, {
      headers: forwardHeaders(req),
    });
    return res.status(r.status).json(r.data);
  } catch (e) {
    return upstreamError(res, e, "ORDER");
  }
}));

// GET /ui/orders/:orderNumber (order + optional delivery)
router.get("/orders/:orderNumber", authMiddleware, asyncWrap(async (req, res) => {
  const orderNumber = String(req.params.orderNumber || "").trim();
  if (!orderNumber) return res.status(400).json({ ok: false, error: "INVALID_ORDER_NUMBER" });

  try {
    const r = await client.get(`${services.order}/orders/${encodeURIComponent(orderNumber)}`, {
      headers: forwardHeaders(req),
    });

    // delivery is optional (may not exist yet)
    let delivery = null;
    try {
      const dr = await client.get(`${services.delivery}/orders/${encodeURIComponent(orderNumber)}`, {
        headers: forwardHeaders(req),
      });
      if (dr?.data?.ok) delivery = dr.data.order;
    } catch {
      delivery = null;
    }

    return res.status(r.status).json({
      ...r.data,
      delivery,
    });
  } catch (e) {
    return upstreamError(res, e, "ORDER");
  }
}));

module.exports = router;
