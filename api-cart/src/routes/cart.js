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

/**
 * GET 장바구니 조회
 * - Kong strip-path=true 환경에서 외부 /cart/items -> 업스트림 /items 로 들어올 수 있으므로 alias 추가
 * - 서비스 직통에서 /cart 또는 /cart/items 로도 들어올 수 있으므로 같이 열어둠
 *
 * 허용 경로:
 *   GET /           (Ingress: /cart)
 *   GET /cart       (svc 직통 호환)
 *   GET /items      (Ingress: /cart/items -> /items)
 *   GET /cart/items (svc 직통 호환)
 */
router.get(["/", "/cart", "/items", "/cart/items"], authMiddleware, asyncWrap(async (req, res) => {
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

/**
 * DELETE 장바구니 아이템 삭제
 * - 프론트 스펙: DELETE /cart/items?option_id=1
 * - Kong strip-path=true 에서 /cart/items -> 업스트림 /items 이 될 수 있으므로 /items도 허용
 * - (선택) cart_item_id 방식도 query로 지원
 *
 * 허용 경로:
 *   DELETE /items?option_id=1
 *   DELETE /cart/items?option_id=1
 *   DELETE /items?cart_item_id=123
 *   DELETE /cart/items?cart_item_id=123
 */
router.delete(["/items", "/cart/items"], authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;

  const optionId = Number(req.query.option_id);
  const cartItemId = Number(req.query.cart_item_id || req.query.cartItemId);

  const hasOptionId = Number.isFinite(optionId) && optionId > 0;
  const hasCartItemId = Number.isFinite(cartItemId) && cartItemId > 0;

  if (!hasOptionId && !hasCartItemId) {
    return res.status(400).json({ ok: false, error: "MISSING_DELETE_KEY" });
  }

  const conn = await pool.getConnection();
  try {
    const cartId = await ensureCart(conn, customerId);

    let r;
    if (hasCartItemId) {
      [r] = await conn.query(
        `DELETE FROM cart_item WHERE cart_id = ? AND cart_item_id = ?`,
        [cartId, cartItemId]
      );
    } else {
      [r] = await conn.query(
        `DELETE FROM cart_item WHERE cart_id = ? AND option_id = ?`,
        [cartId, optionId]
      );
    }

    return res.json({ ok: true, deleted: r.affectedRows || 0 });
  } finally {
    conn.release();
  }
}));

/**
 * PATCH 장바구니 수량 변경/차감
 * - Kong strip-path=true 에서 /cart/items -> 업스트림 /items 이 될 수 있으므로 /items도 허용
 *
 * Request Body (둘 중 하나)
 * 1) qty(절대값 세팅)
 *   { option_id: 1, qty: 3 }
 *   { cart_item_id: 123, qty: 0 }   // 0이면 삭제
 *
 * 2) delta(증감/차감)
 *   { option_id: 1, delta: -1 }     // 차감
 *   { cart_item_id: 123, delta: +2 }
 */
router.patch(["/items", "/cart/items"], authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;

  const optionId = Number(req.body.option_id ?? req.query.option_id);
  const cartItemId = Number(req.body.cart_item_id ?? req.body.cartItemId ?? req.query.cart_item_id ?? req.query.cartItemId);

  const hasOptionId = Number.isFinite(optionId) && optionId > 0;
  const hasCartItemId = Number.isFinite(cartItemId) && cartItemId > 0;

  if (!hasOptionId && !hasCartItemId) {
    return res.status(400).json({ ok: false, error: "MISSING_UPDATE_KEY" });
  }

  const hasQty = req.body.qty !== undefined && req.body.qty !== null && req.body.qty !== "";
  const hasDelta = req.body.delta !== undefined && req.body.delta !== null && req.body.delta !== "";

  if (!hasQty && !hasDelta) {
    return res.status(400).json({ ok: false, error: "MISSING_QTY_OR_DELTA" });
  }

  const qty = hasQty ? Number(req.body.qty) : null;
  const delta = hasDelta ? Number(req.body.delta) : null;

  if (hasQty && (!Number.isFinite(qty) || qty < 0 || qty > 999)) {
    return res.status(400).json({ ok: false, error: "INVALID_QTY" });
  }
  if (hasDelta && (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 999)) {
    return res.status(400).json({ ok: false, error: "INVALID_DELTA" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cartId = await ensureCart(conn, customerId);

    // 현재 row 찾기
    let rows;
    if (hasCartItemId) {
      [rows] = await conn.query(
        `SELECT cart_item_id, option_id, qty FROM cart_item WHERE cart_id=? AND cart_item_id=? LIMIT 1`,
        [cartId, cartItemId]
      );
    } else {
      [rows] = await conn.query(
        `SELECT cart_item_id, option_id, qty FROM cart_item WHERE cart_id=? AND option_id=? LIMIT 1`,
        [cartId, optionId]
      );
    }

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "CART_ITEM_NOT_FOUND" });
    }

    const cur = rows[0];
    const currentQty = Number(cur.qty || 0);
    let newQty = hasQty ? qty : (currentQty + delta);

    if (!Number.isFinite(newQty) || newQty < 0 || newQty > 999) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "QTY_OUT_OF_RANGE" });
    }

    if (newQty === 0) {
      await conn.query(
        `DELETE FROM cart_item WHERE cart_id=? AND cart_item_id=?`,
        [cartId, cur.cart_item_id]
      );
      await conn.commit();
      return res.json({
        ok: true,
        updated: true,
        deleted: true,
        cart_item_id: cur.cart_item_id,
        option_id: cur.option_id,
        qty: 0
      });
    }

    await conn.query(
      `UPDATE cart_item SET qty=?, updated_at=CURRENT_TIMESTAMP WHERE cart_id=? AND cart_item_id=?`,
      [newQty, cartId, cur.cart_item_id]
    );

    await conn.commit();
    return res.json({
      ok: true,
      updated: true,
      cart_item_id: cur.cart_item_id,
      option_id: cur.option_id,
      qty: newQty
    });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}));

// DELETE /cart/clear  (Ingress: /cart/clear -> /clear)
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
// Ingress: /cart/items -> /items  (strip-path=true) 이므로 /items도 허용
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

