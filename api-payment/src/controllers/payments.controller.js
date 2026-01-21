const { pool } = require("../db");
const rabbit = require("../rabbit");
const { randomUUID } = require("crypto");
const { rabbit: rabbitCfg } = require("../config");

async function approve(req, res) {
  const orderNumber = String(req.body.orderNumber || "").trim();
  const provider = String(req.body.provider || "mockpay").trim();
  if (!orderNumber) return res.status(400).json({ ok: false, error: "ORDER_NUMBER_REQUIRED" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orderRows] = await conn.query(
      `SELECT order_id, order_number, customer_id, order_status, total_amount
         FROM orders
        WHERE order_number = ? FOR UPDATE`,
      [orderNumber]
    );
    if (!orderRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });
    }

    const order = orderRows[0];
    if (String(order.order_status).toUpperCase() === "PAID") {
      await conn.commit();
      return res.json({ ok: true, alreadyPaid: true, orderNumber });
    }

    await conn.query(
      `INSERT INTO payments (order_id, customer_id, pay_status, amount, provider, approved_at)
       VALUES (?, ?, 'APPROVED', ?, ?, NOW())`,
      [order.order_id, order.customer_id, order.total_amount, provider]
    );

    await conn.query(`UPDATE orders SET order_status='PAID' WHERE order_id=?`, [order.order_id]);

    await conn.commit();

    const [itemRows] = await pool.query(
      `SELECT skuid, qty FROM order_items WHERE order_id = ? ORDER BY order_item_id ASC`,
      [order.order_id]
    );

    const event = {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: "payment.order.paid",
      data: {
        orderNumber: order.order_number,
        customerId: order.customer_id,
        items: itemRows.map((r) => ({ skuid: r.skuid, qty: r.qty })),
        totalAmount: Number(order.total_amount),
      },
    };

    try {
      await rabbit.publish(rabbitCfg.routingKey, event);
    } catch (e) {
      // MQ 없거나 장애여도 데모 플로우는 계속
      return res.json({ ok: true, orderNumber: order.order_number, paid: true, mq: "FAILED_OR_DISABLED", reason: e.message });
    }

    res.json({ ok: true, orderNumber: order.order_number, paid: true, published: true, eventId: event.eventId });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

async function testPublish(req, res) {
  const event = {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    type: "payment.order.paid",
    data: { orderNumber: "ORD-TEST-0001", customerId: 1, items: [{ skuid: "SKU-101", qty: 1 }], totalAmount: 12000 },
  };

  try {
    await rabbit.publish(rabbitCfg.routingKey, event);
    res.json({ ok: true, published: true });
  } catch (e) {
    res.status(501).json({ ok: false, error: "MQ_DISABLED_OR_FAILED", message: e.message });
  }
}

module.exports = { approve, testPublish };
