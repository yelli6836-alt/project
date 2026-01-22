// api-payment/src/controllers/payments.controller.js
const { pool, timedQuery } = require("../db");
const rabbit = require("../rabbit");
const { randomUUID } = require("crypto");
const { rabbit: rabbitCfg } = require("../config");

// --- timing helpers (db.js와 동일 컨셉: tag=db_timing JSON 로그) ---
function hrMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}
function envBool(name, def = "0") {
  return String(process.env[name] ?? def) === "1";
}
function envNum(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}
function shouldSample(rate) {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}
function safeSql(sql) {
  const s = String(sql || "").replace(/\s+/g, " ").trim();
  return s.length > 160 ? s.slice(0, 160) + "…" : s;
}
function rowCount(rows) {
  if (Array.isArray(rows)) return rows.length;
  if (rows && typeof rows === "object") {
    if (Number.isFinite(rows.affectedRows)) return rows.affectedRows;
    if (Number.isFinite(rows.changedRows)) return rows.changedRows;
  }
  return undefined;
}
function buildCtx(req, op) {
  const base = req.dbCtx || {};
  const rid =
    base.rid ||
    req.reqId ||
    (req.get && req.get("X-Request-Id")) ||
    "-";

  const endpoint =
    base.endpoint ||
    `${req.method} ${req.originalUrl}`;

  return {
    service: base.service || process.env.SERVICE_NAME || "api-payment",
    rid,
    endpoint,
    op,
  };
}
function logDbTiming(ctx, acquireMs, queryMs, totalMs, rows, sql, error) {
  const slowMs = envNum("DB_TIMING_SLOW_MS", 200);
  const rate = envNum("DB_TIMING_SAMPLE_RATE", 1);

  // 샘플링은 요청/쿼리 단위로 적용(간단 버전)
  const sampled = shouldSample(rate);
  if (!sampled) return;

  // 느린 것만
  if (Number(totalMs) < slowMs) return;

  const payload = {
    tag: "db_timing",
    service: ctx?.service || "api-payment",
    rid: ctx?.rid,
    endpoint: ctx?.endpoint,
    op: ctx?.op,
    db_acquire_ms: Number(Number(acquireMs || 0).toFixed(3)),
    db_query_ms: Number(Number(queryMs || 0).toFixed(3)),
    db_total_ms: Number(Number(totalMs || 0).toFixed(3)),
    rows,
    sql: safeSql(sql),
  };

  if (error) payload.error = error;

  if (error) console.warn(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

async function approve(req, res) {
  const orderNumber = String(req.body.orderNumber || "").trim();
  const provider = String(req.body.provider || "mockpay").trim();
  if (!orderNumber) return res.status(400).json({ ok: false, error: "ORDER_NUMBER_REQUIRED" });

  const timingEnabled = envBool("DB_TIMING_ENABLED", "0");

  // 1) TX connection acquire timing
  const t0 = hrMs();
  let conn;
  let acquireMs = 0;

  try {
    conn = await pool.getConnection();
    acquireMs = hrMs() - t0;

    if (timingEnabled) {
      // acquire 자체가 느린 경우도 원인 분리 포인트라 따로 로그
      const ctx = buildCtx(req, "approve.tx_acquire");
      logDbTiming(ctx, acquireMs, 0, acquireMs, undefined, "POOL_GET_CONNECTION");
    }

    // 2) beginTransaction timing (선택이지만 같이 보면 좋음)
    if (timingEnabled) {
      const bt0 = hrMs();
      await conn.beginTransaction();
      const btMs = hrMs() - bt0;
      const ctx = buildCtx(req, "approve.tx_begin");
      logDbTiming(ctx, 0, btMs, btMs, undefined, "BEGIN");
    } else {
      await conn.beginTransaction();
    }

    // 3) SELECT ... FOR UPDATE
    {
      const sql = `SELECT order_id, order_number, customer_id, order_status, total_amount
         FROM orders
        WHERE order_number = ? FOR UPDATE`;
      const q0 = hrMs();
      const [orderRows] = await conn.query(sql, [orderNumber]);
      const qMs = hrMs() - q0;

      if (timingEnabled) {
        const ctx = buildCtx(req, "approve.order_select_for_update");
        logDbTiming(ctx, 0, qMs, qMs, rowCount(orderRows), sql);
      }

      if (!orderRows.length) {
        if (timingEnabled) {
          const rb0 = hrMs();
          await conn.rollback();
          const rbMs = hrMs() - rb0;
          const ctx = buildCtx(req, "approve.tx_rollback_not_found");
          logDbTiming(ctx, 0, rbMs, rbMs, undefined, "ROLLBACK");
        } else {
          await conn.rollback();
        }
        return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });
      }

      const order = orderRows[0];

      // already PAID
      if (String(order.order_status).toUpperCase() === "PAID") {
        if (timingEnabled) {
          const cm0 = hrMs();
          await conn.commit();
          const cmMs = hrMs() - cm0;
          const ctx = buildCtx(req, "approve.tx_commit_already_paid");
          logDbTiming(ctx, 0, cmMs, cmMs, undefined, "COMMIT");
        } else {
          await conn.commit();
        }
        return res.json({ ok: true, alreadyPaid: true, orderNumber });
      }

      // 4) INSERT payments
      {
        const sql2 = `INSERT INTO payments (order_id, customer_id, pay_status, amount, provider, approved_at)
       VALUES (?, ?, 'APPROVED', ?, ?, NOW())`;
        const q0b = hrMs();
        const [r] = await conn.query(sql2, [order.order_id, order.customer_id, order.total_amount, provider]);
        const qMs2 = hrMs() - q0b;

        if (timingEnabled) {
          const ctx = buildCtx(req, "approve.payments_insert");
          logDbTiming(ctx, 0, qMs2, qMs2, rowCount(r), sql2);
        }
      }

      // 5) UPDATE orders status
      {
        const sql3 = `UPDATE orders SET order_status='PAID' WHERE order_id=?`;
        const q0c = hrMs();
        const [r2] = await conn.query(sql3, [order.order_id]);
        const qMs3 = hrMs() - q0c;

        if (timingEnabled) {
          const ctx = buildCtx(req, "approve.orders_update_paid");
          logDbTiming(ctx, 0, qMs3, qMs3, rowCount(r2), sql3);
        }
      }

      // 6) commit
      if (timingEnabled) {
        const cm0 = hrMs();
        await conn.commit();
        const cmMs = hrMs() - cm0;
        const ctx = buildCtx(req, "approve.tx_commit");
        logDbTiming(ctx, 0, cmMs, cmMs, undefined, "COMMIT");
      } else {
        await conn.commit();
      }

      // 7) order_items SELECT (TX 밖에서 pool.query 하던 부분 → timedQuery로 교체)
      //    => 여기서는 timedQuery가 acquire/query 분리 로그를 찍어줌 (enabled일 때)
      const [itemRows] = await timedQuery(
        buildCtx(req, "approve.order_items_select"),
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
        return res.json({
          ok: true,
          orderNumber: order.order_number,
          paid: true,
          mq: "FAILED_OR_DISABLED",
          reason: e.message,
        });
      }

      return res.json({ ok: true, orderNumber: order.order_number, paid: true, published: true, eventId: event.eventId });
    }
  } catch (e) {
    try {
      if (conn) await conn.rollback();
    } catch {}
    throw e;
  } finally {
    try {
      if (conn) conn.release();
    } catch {}
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

