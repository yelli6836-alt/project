const { connectRabbit } = require("./rabbit");
const { pool } = require("./db");
const { rabbit, wms } = require("./config");

function safeJson(buf) {
  try { return JSON.parse(buf.toString("utf8")); } catch { return null; }
}

async function handlePaidEvent(evt, conn) {
  if (!evt || evt.type !== "payment.order.paid") throw new Error("INVALID_EVENT_TYPE");

  const eventId = String(evt.eventId || "");
  if (!eventId) throw new Error("MISSING_eventId");

  const orderNumber = String(evt.data?.orderNumber || "");
  const items = Array.isArray(evt.data?.items) ? evt.data.items : [];
  if (!orderNumber || items.length === 0) throw new Error("MISSING_ORDER_OR_ITEMS");

  // inbox_events 멱등
  const [inbox] = await conn.query(
    `SELECT event_id FROM inbox_events WHERE event_id = :event_id LIMIT 1 FOR UPDATE`,
    { event_id: eventId }
  );
  if (inbox.length) return { duplicated: true };

  await conn.query(
    `INSERT INTO inbox_events(event_id) VALUES(:event_id)`,
    { event_id: eventId }
  );

  for (const it of items) {
    const skuid = String(it.skuid || "");
    const qty = Number(it.qty || 0);
    if (!skuid || qty <= 0) throw new Error("INVALID_ITEM");

    const [r] = await conn.query(
      `SELECT itemID FROM item_name WHERE SKUID = :skuid`,
      { skuid }
    );
    if (!r.length) throw new Error(`SKUID_NOT_FOUND: ${skuid}`);
    const itemID = r[0].itemID;

    await conn.query(
      `INSERT INTO stock_reservations(order_number, skuid, qty, placeID, status)
       VALUES(:order_number, :skuid, :qty, :placeID, 'RESERVED')
       ON DUPLICATE KEY UPDATE qty = VALUES(qty)`,
      { order_number: orderNumber, skuid, qty, placeID: wms.deductPlaceId }
    );

    const [u] = await conn.query(
      `UPDATE inventory
          SET unit = unit - :qty
        WHERE itemID = :itemID AND placeID = :placeID AND unit >= :qty`,
      { qty, itemID, placeID: wms.deductPlaceId }
    );

    if (u.affectedRows !== 1) {
      throw new Error(`INSUFFICIENT_STOCK (skuid=${skuid}, placeID=${wms.deductPlaceId}, qty=${qty})`);
    }

    await conn.query(
      `UPDATE stock_reservations
          SET status='DEDUCTED'
        WHERE order_number=:order_number AND skuid=:skuid`,
      { order_number: orderNumber, skuid }
    );
  }

  return { duplicated: false };
}

async function start() {
  const { conn, ch } = await connectRabbit();

  ch.prefetch(10);
  console.log(`[api-wms] consuming queue=${rabbit.queue}`);

  ch.consume(rabbit.queue, async (msg) => {
    if (!msg) return;

    const evt = safeJson(msg.content);

    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const r = await handlePaidEvent(evt, db);
      await db.commit();
      ch.ack(msg);
      if (r.duplicated) console.log("[api-wms] duplicated ignored:", evt?.eventId);
    } catch (e) {
      try { await db.rollback(); } catch {}
      console.error("[api-wms] consume error:", e.message);
      ch.nack(msg, false, true);
    } finally {
      db.release();
    }
  }, { noAck: false });

  process.on("SIGINT", async () => {
    try { await ch.close(); } catch {}
    try { await conn.close(); } catch {}
    process.exit(0);
  });
}

start().catch((e) => {
  console.error("Failed to start consumer:", e);
  process.exit(1);
});
