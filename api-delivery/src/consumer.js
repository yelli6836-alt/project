const { connect } = require("./rabbit");
const { pool } = require("./db");
const { rabbit } = require("./config");

async function ensureDefaultCenter(conn) {
  await conn.query(
    `INSERT INTO centers (center_id, center_name)
     VALUES (1, 'DEFAULT_CENTER')
     ON DUPLICATE KEY UPDATE center_name=center_name`
  );
}

async function handlePaid(event) {
  const eventId = event?.eventId;
  const orderNumber = event?.data?.orderNumber;
  const customerId = event?.data?.customerId ?? null;

  if (!eventId || !orderNumber) throw new Error("INVALID_EVENT");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dup] = await conn.query(
      `SELECT event_id FROM inbox_events WHERE event_id=? FOR UPDATE`,
      [eventId]
    );
    if (dup.length) { await conn.rollback(); return { duplicated: true }; }

    await conn.query(`INSERT INTO inbox_events (event_id) VALUES (?)`, [eventId]);

    await ensureDefaultCenter(conn);

    await conn.query(
      `INSERT INTO orders (order_number, center_id, ordered_at, order_status, customer_id, customer_address, unit, cost)
       VALUES (?, 1, NOW(), 'READY', ?, NULL, 0, NULL)
       ON DUPLICATE KEY UPDATE order_status = VALUES(order_status)`,
      [orderNumber, customerId]
    );

    await conn.commit();
    return { duplicated: false };
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

async function main() {
  const { conn, ch } = await connect();
  console.log("[api-delivery] consuming queue=" + rabbit.queue);

  ch.consume(rabbit.queue, async (msg) => {
    if (!msg) return;
    try {
      const event = JSON.parse(msg.content.toString("utf8"));
      if (event.type !== "payment.order.paid") { ch.ack(msg); return; }

      const r = await handlePaid(event);
      ch.ack(msg);
      if (r.duplicated) console.log("[delivery] duplicated ignored:", event.eventId);
      else console.log("[delivery] READY created:", event.data.orderNumber);
    } catch (e) {
      console.error("[delivery] failed:", e.message);
      ch.nack(msg, false, true);
    }
  }, { noAck: false });

  process.on("SIGINT", async () => {
    try { await ch.close(); } catch {}
    try { await conn.close(); } catch {}
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("consumer boot failed:", e);
  process.exit(1);
});
