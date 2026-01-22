const router = require("express").Router();
const axios = require("axios");
const asyncWrap = require("../utils/asyncWrap");
const { authMiddleware } = require("../utils/authMiddleware");
const { pool } = require("../db");
const { product: productCfg } = require("../config");

async function ensureCart(conn, customerId) {
  const [rows] = await conn.query(`SELECT cart_id FROM cart WHERE customer_id = ? LIMIT 1`, [customerId]);
  if (rows.length) return rows[0].cart_id;
  const [r] = await conn.query(`INSERT INTO cart (customer_id) VALUES (?)`, [customerId]);
  return r.insertId;
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

async function resolveSnapshotFromProduct(itemId, optionId) {
  if (!productCfg.baseUrl) throw new Error("PRODUCT_API_BASE_NOT_SET");

  const itemRes = await axios.get(`${productCfg.baseUrl}/products/${itemId}`, { timeout: 5000 });
  const item = itemRes?.data?.item;
  const itemName = String(item?.item_name || "");
  const baseCostCents = moneyToCents(item?.base_cost);

  const optRes = await axios.get(`${productCfg.baseUrl}/products/${itemId}/options`, { timeout: 5000 });
  const options = Array.isArray(optRes?.data?.options) ? optRes.data.options : [];
  const opt = options.find((o) => Number(o.option_id) === Number(optionId));
  if (!opt) throw new Error("OPTION_NOT_FOUND_IN_PRODUCT");

  const skuid = String(opt.skuid || "").trim();
  const addCostCents = moneyToCents(opt.add_cost);

  if (!skuid) throw new Error("SKUID_EMPTY_FROM_PRODUCT");
  if (!Number.isFinite(baseCostCents) || !Number.isFinite(addCostCents)) throw new Error("INVALID_PRICE_FROM_PRODUCT");

  const priceCents = baseCostCents + addCostCents;
  const optionName = String(opt.option_name || "").trim();
  const optionValue = String(opt.option_value || "").trim();
  const itemNameSnapshot = optionName && optionValue ? `${itemName} (${optionName}:${optionValue})` : itemName;

  return { skuid, item_name_snapshot: itemNameSnapshot, price_snapshot: (priceCents / 100).toFixed(2) };
}

// GET /cart
router.get("/", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  const conn = await pool.getConnection();
  try {
    const cartId = await ensureCart(conn, customerId);
    const [items] = await conn.query(
      `SELECT cart_item_id, cart_id, item_id, option_id, skuid, item_name_snapshot, qty, price_snapshot, created_at, updated_at
         FROM cart_item
        WHERE cart_id = ?
        ORDER BY cart_item_id DESC`,
      [cartId]
    );
    res.json({ ok: true, cart: { cart_id: cartId, customer_id: customerId }, items });
  } finally {
    conn.release();
  }
}));

// DELETE /cart/clear
router.delete("/clear", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cartId = await ensureCart(conn, customerId);
    await conn.query(`DELETE FROM cart_item WHERE cart_id = ?`, [cartId]);
    await conn.commit();
    res.json({ ok: true, cleared: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}));

// POST /cart/items { item_id, option_id, qty, (optional) skuid, item_name_snapshot, price_snapshot }
router.post(["/items","/cart/items"], authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  const itemId = Number(req.body.item_id);
  const optionId = Number(req.body.option_id);
  const qty = Number(req.body.qty || 1);

  if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ ok: false, error: "INVALID_ITEM_ID" });
  if (!Number.isFinite(optionId) || optionId <= 0) return res.status(400).json({ ok: false, error: "INVALID_OPTION_ID" });
  if (!Number.isFinite(qty) || qty <= 0 || qty > 999) return res.status(400).json({ ok: false, error: "INVALID_QTY" });

  let skuid = String(req.body.skuid || "").trim();
  let itemNameSnapshot = String(req.body.item_name_snapshot || "").trim();
  let priceSnapshot = req.body.price_snapshot;

  if (!skuid || !itemNameSnapshot || priceSnapshot == null) {
    const snap = await resolveSnapshotFromProduct(itemId, optionId);
    skuid = snap.skuid;
    itemNameSnapshot = snap.item_name_snapshot;
    priceSnapshot = snap.price_snapshot;
  }

  const priceCents = moneyToCents(priceSnapshot);
  if (!Number.isFinite(priceCents) || priceCents < 0) return res.status(400).json({ ok: false, error: "INVALID_PRICE_SNAPSHOT" });
  priceSnapshot = (priceCents / 100).toFixed(2);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cartId = await ensureCart(conn, customerId);

    await conn.query(
      `INSERT INTO cart_item (cart_id, item_id, option_id, skuid, item_name_snapshot, qty, price_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         qty = qty + VALUES(qty),
         skuid = VALUES(skuid),
         item_name_snapshot = VALUES(item_name_snapshot),
         price_snapshot = VALUES(price_snapshot),
         updated_at = CURRENT_TIMESTAMP`,
      [cartId, itemId, optionId, skuid, itemNameSnapshot, qty, priceSnapshot]
    );

    const [rows] = await conn.query(
      `SELECT cart_item_id, cart_id, item_id, option_id, skuid, item_name_snapshot, qty, price_snapshot, created_at, updated_at
         FROM cart_item
        WHERE cart_id = ? AND option_id = ?
        LIMIT 1`,
      [cartId, optionId]
    );

    await conn.commit();
    res.status(201).json({ ok: true, item: rows[0] });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = router;
