const router = require("express").Router();
const crypto = require("crypto");
const asyncWrap = require("../utils/asyncWrap");
const { authMiddleware } = require("../utils/authMiddleware");
const { pool } = require("../db");
const { cart: cartCfg } = require("../config");

function makeOrderNumber() {
  const t = Date.now();
  const s = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `ORD-${t}-${s}`;
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

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) return null;

  const out = [];
  for (const it of items) {
    const skuid = String(it.skuid || "").trim();
    const itemName = String(it.item_name || it.item_name_snapshot || "").trim();
    const qty = Number(it.qty ?? 0);
    const price = it.price_at_purchase ?? it.price_snapshot;

    const itemId = it.item_id != null ? Number(it.item_id) : null;
    const optionId = it.option_id != null ? Number(it.option_id) : null;

    if (!skuid || !itemName) return null;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 999) return null;

    const priceCents = moneyToCents(price);
    if (!Number.isFinite(priceCents) || priceCents < 0) return null;

    out.push({
      skuid,
      item_name: itemName,
      qty,
      price_at_purchase: (priceCents / 100).toFixed(2),
      item_id: itemId != null && Number.isFinite(itemId) ? itemId : null,
      option_id: optionId != null && Number.isFinite(optionId) ? optionId : null,
    });
  }
  return out;
}

async function createOrderTx(conn, customerId, items, extra) {
  const orderNumber = makeOrderNumber();

  let totalCents = 0;
  for (const it of items) totalCents += moneyToCents(it.price_at_purchase) * it.qty;
  const totalAmount = (totalCents / 100).toFixed(2);

  const receiverName = extra?.receiver_name ? String(extra.receiver_name).trim() : null;
  const shippingAddress = extra?.shipping_address ? String(extra.shipping_address).trim() : null;

  const [r1] = await conn.query(
    `INSERT INTO orders (order_number, customer_id, order_status, total_amount, receiver_name, shipping_address)
     VALUES (?, ?, 'CREATED', ?, ?, ?)`,
    [orderNumber, customerId, totalAmount, receiverName, shippingAddress]
  );
  const orderId = r1.insertId;

  const values = items.map((it) => [
    orderId,
    it.item_id || 0,
    it.option_id,
    it.skuid,
    it.item_name,
    it.price_at_purchase,
    it.qty,
  ]);

  await conn.query(
    `INSERT INTO order_items
      (order_id, item_id, option_id, skuid, item_name, price_at_purchase, qty)
     VALUES ?`,
    [values]
  );

  return { order_id: orderId, order_number: orderNumber, total_amount: totalAmount };
}

/* GET /orders */
router.get("/", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;

  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(50, Math.max(1, Number(req.query.size || 20)));
  const offset = (page - 1) * size;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM orders WHERE customer_id = ?`,
    [customerId]
  );

  const [rows] = await pool.query(
    `SELECT order_id, order_number, customer_id, order_status, total_amount, created_at, updated_at
       FROM orders
      WHERE customer_id = ?
      ORDER BY order_id DESC
      LIMIT ? OFFSET ?`,
    [customerId, size, offset]
  );

  res.json({ ok: true, page, size, total: countRows[0].total, orders: rows });
}));

/* POST /orders */
router.post("/", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  const items = normalizeItems(req.body?.items);
  if (!items) return res.status(400).json({ ok: false, error: "INVALID_ITEMS" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const created = await createOrderTx(conn, customerId, items, req.body);
    await conn.commit();
    res.status(201).json({ ok: true, order: created });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}));

/* POST /orders/from-cart */
router.post("/from-cart", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  if (!cartCfg.baseUrl) return res.status(501).json({ ok: false, error: "CART_API_NOT_CONFIGURED" });

  const auth = req.headers.authorization;

  const cartResp = await fetch(`${cartCfg.baseUrl}/cart`, { headers: { Authorization: auth } });
  if (!cartResp.ok) return res.status(502).json({ ok: false, error: "CART_API_ERROR" });

  const cartJson = await cartResp.json();
  const cartItems = Array.isArray(cartJson.items) ? cartJson.items : [];
  if (!cartItems.length) return res.status(400).json({ ok: false, error: "CART_EMPTY" });

  const items = normalizeItems(cartItems.map((it) => ({
    skuid: it.skuid,
    item_name_snapshot: it.item_name_snapshot,
    price_snapshot: it.price_snapshot,
    qty: it.qty,
    item_id: it.item_id,
    option_id: it.option_id,
  })));

  if (!items) return res.status(400).json({ ok: false, error: "INVALID_CART_ITEM" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const created = await createOrderTx(conn, customerId, items, req.body);
    await conn.commit();

    // cart clear (실패해도 주문은 성공)
    const clearResp = await fetch(`${cartCfg.baseUrl}/cart/clear`, {
      method: "DELETE",
      headers: { Authorization: auth },
    });
    if (!clearResp.ok) {
      return res.status(201).json({ ok: true, order: created, warn: "ORDER_CREATED_BUT_CART_CLEAR_FAILED" });
    }

    res.status(201).json({ ok: true, order: created });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}));

/* POST /orders/:orderNumber/cancel  (CREATED -> CANCELED) */
router.post("/:orderNumber/cancel", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  const orderNumber = String(req.params.orderNumber || "").trim();

  const [upd] = await pool.query(
    `UPDATE orders
        SET order_status='CANCELED'
      WHERE order_number=? AND customer_id=? AND order_status='CREATED'`,
    [orderNumber, customerId]
  );

  if (!upd.affectedRows) return res.status(400).json({ ok: false, error: "CANNOT_CANCEL" });
  res.json({ ok: true, canceled: true, order_number: orderNumber });
}));

/* GET /orders/:orderNumber */
router.get("/:orderNumber", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  const orderNumber = String(req.params.orderNumber || "").trim();

  const [orders] = await pool.query(
    `SELECT order_id, order_number, customer_id, order_status, total_amount, receiver_name, shipping_address, created_at, updated_at
       FROM orders
      WHERE order_number=? AND customer_id=?
      LIMIT 1`,
    [orderNumber, customerId]
  );

  if (!orders.length) return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });

  const order = orders[0];
  const [items] = await pool.query(
    `SELECT order_item_id, order_id, item_id, option_id, skuid, item_name, price_at_purchase, qty, created_at
       FROM order_items
      WHERE order_id=?
      ORDER BY order_item_id ASC`,
    [order.order_id]
  );

  res.json({ ok: true, order, items });
}));

module.exports = router;
