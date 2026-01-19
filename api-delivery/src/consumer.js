const { connect } = require("./rabbit");
const { pool } = require("./db");
const { rabbit } = require("./config");

function safeJson(buf) {
  try { return JSON.parse(buf.toString("utf8")); } catch { return null; }
}

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

  if (!eventId || !orderNumber) throw new Error("INVALID_EVENT_PAYLOAD");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [inbox] = await conn.query(
      `SELECT event_id FROM inbox_events WHERE event_id=? FOR UPDATE`,
      [eventId]
    );
    if (inbox.length) {
      await conn.rollback();
      return { duplicated: true };
    }

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
  console.log(`[api-delivery] consumer connected. waiting queue=${rabbit.queue}`);

  ch.consume(
    rabbit.queue,
    async (msg) => {
      if (!msg) return;
      const evt = safeJson(msg.content);

      try {
        if (!evt || evt.type !== "payment.order.paid") {
          ch.ack(msg);
          return;
        }

        const result = await handlePaid(evt);
        ch.ack(msg);

        if (result.duplicated) console.log("[delivery] duplicated ignored:", evt.eventId);
        else console.log("[delivery] order READY created:", evt.data.orderNumber);
      } catch (e) {
        console.error("[delivery] failed:", e.message);
        ch.nack(msg, false, true);
      }
    },
    { noAck: false }
  );

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
