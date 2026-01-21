const { connectRabbit } = require("./rabbit");
const { pool } = require("./db");
const { rabbit, wms } = require("./config");

function safeJson(buf) { try { return JSON.parse(buf.toString("utf8")); } catch { return null; } }
function asStr(v) { return String(v ?? "").trim(); }
function asPosInt(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; }

async function pickPlaceIdForDeduct(conn, skuid, qty, preferPlaceId) {
  if (Number.isFinite(preferPlaceId) && preferPlaceId > 0) {
    const [rows] = await conn.query(
      `SELECT place_id, qty FROM inventory
        WHERE place_id = :place_id AND skuid = :skuid
        FOR UPDATE`,
      { place_id: preferPlaceId, skuid }
    );
    if (rows.length && Number(rows[0].qty) >= qty) return Number(rows[0].place_id);
  }

  const [alt] = await conn.query(
    `SELECT place_id, qty FROM inventory
      WHERE skuid = :skuid AND qty >= :qty
      ORDER BY qty DESC
      LIMIT 1
      FOR UPDATE`,
    { skuid, qty }
  );
  if (!alt.length) throw new Error(`INSUFFICIENT_STOCK (skuid=${skuid}, qty=${qty})`);
  return Number(alt[0].place_id);
}

async function handlePaidEvent(evt) {
  if (!evt || evt.type !== "payment.order.paid") throw new Error("INVALID_EVENT_TYPE");

  const eventId = asStr(evt.eventId);
  const orderNumber = asStr(evt.data?.orderNumber);
  const items = Array.isArray(evt.data?.items) ? evt.data.items : [];

  if (!eventId) throw new Error("MISSING_eventId");
  if (!orderNumber) throw new Error("MISSING_orderNumber");
  if (!items.length) throw new Error("MISSING_items");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dup] = await conn.query(
      `SELECT event_id FROM inbox_events WHERE event_id = :event_id FOR UPDATE`,
      { event_id: eventId }
    );
    if (dup.length) { await conn.rollback(); return { duplicated: true }; }

    await conn.query(
      `INSERT INTO inbox_events(event_id, event_type, payload)
       VALUES (:event_id, :event_type, :payload)`,
      { event_id: eventId, event_type: "payment.order.paid", payload: JSON.stringify(evt) }
    );

    for (const it of items) {
      const skuid = asStr(it.skuid);
      const qty = asPosInt(it.qty);
      if (!skuid || !qty) throw new Error("INVALID_ITEM");

      const [skuRows] = await conn.query(
        `SELECT skuid FROM sku_master WHERE skuid = :skuid LIMIT 1`,
        { skuid }
      );
      if (!skuRows.length) throw new Error(`SKUID_NOT_FOUND: ${skuid}`);

      const placeId = await pickPlaceIdForDeduct(conn, skuid, qty, wms.deductPlaceId);

      await conn.query(
        `INSERT INTO stock_reservations(order_number, skuid, qty, status, place_id)
         VALUES (:order_number, :skuid, :qty, 'RESERVED', :place_id)
         ON DUPLICATE KEY UPDATE
           qty = VALUES(qty),
           place_id = VALUES(place_id),
           status = 'RESERVED'`,
        { order_number: orderNumber, skuid, qty, place_id: placeId }
      );

      const [u] = await conn.query(
        `UPDATE inventory
            SET qty = qty - :qty
          WHERE place_id = :place_id AND skuid = :skuid AND qty >= :qty`,
        { qty, place_id: placeId, skuid }
      );
      if (u.affectedRows !== 1) throw new Error(`DEDUCT_FAILED (skuid=${skuid}, place_id=${placeId}, qty=${qty})`);

      await conn.query(
        `UPDATE stock_reservations
            SET status = 'DEDUCTED'
          WHERE order_number = :order_number AND skuid = :skuid`,
        { order_number: orderNumber, skuid }
      );
    }

    await conn.commit();
    return { duplicated: false };
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

async function start() {
  const { conn, ch } = await connectRabbit();
  ch.prefetch(10);

  console.log("[api-wms] consuming queue=" + rabbit.queue);
  ch.consume(rabbit.queue, async (msg) => {
    if (!msg) return;
    const evt = safeJson(msg.content);

    try {
      const r = await handlePaidEvent(evt);
      ch.ack(msg);
      if (r.duplicated) console.log("[api-wms] duplicated ignored:", evt?.eventId);
      else console.log("[api-wms] deducted order:", evt?.data?.orderNumber);
    } catch (e) {
      console.error("[api-wms] consume error:", e.message);
      ch.nack(msg, false, true);
    }
  }, { noAck: false });

  process.on("SIGINT", async () => {
    try { await ch.close(); } catch {}
    try { await conn.close(); } catch {}
    process.exit(0);
  });
}

start().catch((e) => { console.error("Failed to start consumer:", e); process.exit(1); });
