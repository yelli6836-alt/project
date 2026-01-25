// api-delivery/src/controllers/delivery.controller.js
const { pool } = require("../db");
const crypto = require("crypto");

const ALLOWED = new Set(["READY", "SHIPPING", "DELIVERED"]);
const NEXT = { READY: "SHIPPING", SHIPPING: "DELIVERED" };

// ✅ 데모/테스트용: 1분 단위 타임라인(0~5분)
const DELIVERY_TIMELINE_MIN = [
  { m: 0, status: "배송준비중", location: "동탄 물류센터" },
  { m: 1, status: "상품준비중", location: "동탄 물류센터" },
  { m: 2, status: "집화완료",   location: "동탄 물류센터" },
  { m: 3, status: "배송중",     location: "수도권 메가허브" },
  { m: 4, status: "배송출발",   location: "송파 캠프" },
  { m: 5, status: "배송완료",   location: "수령지" },
];

function pickCarrier(orderNumber) {
  const carriers = ["쿠펑 로켓배송", "CJ Logistics", "한진택배"];
  const h = crypto.createHash("sha1").update(String(orderNumber)).digest("hex");
  const idx = parseInt(h.slice(0, 2), 16) % carriers.length;
  return carriers[idx];
}

function makeTrackingNumber(orderNumber) {
  // orderNumber로부터 고정된 트래킹번호 생성(새로고침해도 동일)
  const h = crypto.createHash("sha1").update(String(orderNumber)).digest("hex");
  const digits = h.replace(/[a-f]/g, "").padEnd(12, "0").slice(0, 12);
  return `${digits.slice(0,4)}-${digits.slice(4,8)}-${digits.slice(8,12)}`;
}

function parseCreatedAtMs(orderNumber, orderedAt) {
  // 1) ordered_at(또는 orderedAt)이 있으면 최우선
  const t1 = orderedAt ? Date.parse(orderedAt) : NaN;
  if (Number.isFinite(t1)) return t1;

  // 2) orderNumber가 ORD-<ms>-XX 형태면 timestamp(ms) 파싱
  const m = String(orderNumber || "").match(/^ORD-(\d{10,})-/);
  const ms = m ? Number(m[1]) : NaN;
  if (Number.isFinite(ms)) return ms;

  // 3) fallback: 지금
  return Date.now();
}

function buildDelivery(orderNumber, orderedAt, customerAddress) {
  const nowMs = Date.now();
  const base = parseCreatedAtMs(orderNumber, orderedAt);

  const history = DELIVERY_TIMELINE_MIN
    .map(e => {
      const t = base + e.m * 60 * 1000;
      const location =
        (e.status === "배송완료" && customerAddress)
          ? String(customerAddress)
          : e.location;

      return { t, time: new Date(t).toISOString(), status: e.status, location };
    })
    .filter(e => e.t <= nowMs)
    .map(({ time, status, location }) => ({ time, status, location }));

  // 최소 1개는 보장
  if (!history.length) {
    history.push({
      time: new Date(base).toISOString(),
      status: "배송준비중",
      location: "동탄 물류센터",
    });
  }

  return {
    carrier: pickCarrier(orderNumber),
    tracking_number: makeTrackingNumber(orderNumber),
    history,
  };
}

async function getOrder(req, res) {
  const orderNumber = String(req.params.orderNumber || "").trim();
  if (!orderNumber) return res.status(400).json({ ok: false, error: "INVALID_ORDER_NUMBER" });

  const [rows] = await pool.query(
    `SELECT order_number, center_id, ordered_at, order_status, customer_id, customer_address, unit, cost
       FROM orders
      WHERE order_number = ?`,
    [orderNumber]
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });

  const order = rows[0];

  // ✅ 핵심: 배송추적 정보를 "조회 시점에 계산"해서 order에 붙임(DB 수정 없음)
  order.delivery = buildDelivery(order.order_number, order.ordered_at, order.customer_address);

  return res.json({ ok: true, order });
}

async function updateStatus(req, res) {
  const orderNumber = String(req.params.orderNumber || "").trim();
  const nextStatus = String(req.body.status || "").trim().toUpperCase();
  if (!ALLOWED.has(nextStatus)) return res.status(400).json({ ok: false, error: "INVALID_STATUS" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT order_id, order_status FROM orders WHERE order_number=? FOR UPDATE`,
      [orderNumber]
    );
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" }); }

    const cur = String(rows[0].order_status || "").toUpperCase();
    if (NEXT[cur] !== nextStatus) {
      await conn.rollback();
      return res.status(409).json({ ok: false, error: "INVALID_TRANSITION", message: `current=${cur}, allowed=${NEXT[cur] || "none"}` });
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

