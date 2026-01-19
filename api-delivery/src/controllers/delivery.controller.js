const { pool } = require("../db");

const ALLOWED = new Set(["READY", "SHIPPING", "DELIVERED"]);
const NEXT = { READY: "SHIPPING", SHIPPING: "DELIVERED" };

async function getOrder(req, res) {
  const orderNumber = String(req.params.orderNumber || "").trim();

  const [rows] = await pool.query(
    `SELECT order_number, center_id, ordered_at, order_status, customer_id, customer_address, unit, cost
       FROM orders
      WHERE order_number = ?`,
    [orderNumber]
  );

  if (!rows.length) return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });
  res.json({ ok: true, order: rows[0] });
}

async function updateStatus(req, res) {
  const orderNumber = String(req.params.orderNumber || "").trim();
  const nextStatus = String(req.body.status || "").trim().toUpperCase();

  if (!ALLOWED.has(nextStatus)) {
    return res.status(400).json({ ok: false, error: "INVALID_STATUS" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT order_id, order_status FROM orders WHERE order_number=? FOR UPDATE`,
      [orderNumber]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });
    }

    const cur = String(rows[0].order_status || "").toUpperCase();

    if (NEXT[cur] !== nextStatus) {
      await conn.rollback();
      return res.status(409).json({
        ok: false,
        error: "INVALID_TRANSITION",
        message: `current=${cur}, allowed=${NEXT[cur] || "none"}`,
      });
    }

    await conn.query(`UPDATE orders SET order_status=? WHERE order_id=?`, [nextStatus, rows[0].order_id]);

    await conn.commit();
    res.json({ ok: true, orderNumber, status: nextStatus });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { getOrder, updateStatus };
