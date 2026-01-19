const { pool } = require("../db");
const rabbit = require("../rabbit");
const config = require("../config");
const { randomUUID } = require("crypto");

async function pingDb(req, res) {
  const [rows] = await pool.query("SELECT DATABASE() AS db, NOW() AS now");
  res.json({ ok: true, ...rows[0] });
}

async function testPublish(req, res) {
  const event = {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    type: "payment.order.paid",
    data: {
      orderNumber: "ORD-TEST-0001",
      customerId: 1,
      items: [{ skuid: "SKU-101", qty: 1 }],
      totalAmount: 12000,
    },
  };

  await rabbit.publish(config.rabbit.routingKey, event);
  res.json({ ok: true, published: true, routingKey: config.rabbit.routingKey });
}

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
      `SELECT skuid, qty
         FROM order_items
        WHERE order_id = ?
        ORDER BY order_item_id ASC`,
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

    await rabbit.publish(config.rabbit.routingKey, event);

    res.json({ ok: true, orderNumber: order.order_number, published: true, eventId: event.eventId });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { pingDb, testPublish, approve };
