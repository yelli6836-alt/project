const mysql = require("mysql2/promise");
const crypto = require("crypto");
const { db } = require("./config");

const pool = mysql.createPool({
  host: db.host,
  port: db.port,
  user: db.user,
  password: db.password,
  database: db.database,
  waitForConnections: true,
  connectionLimit: db.connectionLimit,
});

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

function shouldSample() {
  const rate = envNum("DB_TIMING_SAMPLE_RATE", 1); // 기본 100%
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

/**
 * timedQuery(ctx, sql, params)
 * - db_acquire_ms: pool.getConnection() 소요시간
 * - db_query_ms: conn.query() 소요시간
 * - ENV:
 *   DB_TIMING_ENABLED=1 (기본 0)
 *   DB_TIMING_SLOW_MS=200 (기본 200ms 이상만 로그)
 *   DB_TIMING_SAMPLE_RATE=1 (기본 1=100%)
 */
async function timedQuery(ctx, sql, params) {
  const enabled = envBool("DB_TIMING_ENABLED", "0");
  if (!enabled || !shouldSample()) {
    return pool.query(sql, params);
  }

  const slowMs = envNum("DB_TIMING_SLOW_MS", 200);

  const t0 = hrMs();
  let conn;
  let acquireMs = 0;
  let queryMs = 0;

  try {
    conn = await pool.getConnection();
    const t1 = hrMs();
    acquireMs = t1 - t0;

    const t2 = hrMs();
    const result = await conn.query(sql, params);
    const t3 = hrMs();
    queryMs = t3 - t2;

    const totalMs = (t3 - t0);

    if (totalMs >= slowMs) {
      // 1줄 JSON 로그(파싱 쉬움)
      console.log(
        JSON.stringify({
          tag: "db_timing",
          service: ctx?.service || process.env.SERVICE_NAME || "api-payment",
          rid: ctx?.rid,
          endpoint: ctx?.endpoint,
          op: ctx?.op,
          db_acquire_ms: Number(acquireMs.toFixed(3)),
          db_query_ms: Number(queryMs.toFixed(3)),
          db_total_ms: Number(totalMs.toFixed(3)),
          rows: rowCount(result?.[0]),
          sql: safeSql(sql),
        })
      );
    }

    return result;
  } catch (e) {
    const tEnd = hrMs();
    const totalMs = (tEnd - t0);

    console.warn(
      JSON.stringify({
        tag: "db_timing",
        service: ctx?.service || process.env.SERVICE_NAME || "api-payment",
        rid: ctx?.rid,
        endpoint: ctx?.endpoint,
        op: ctx?.op,
        error: e?.code || e?.message || "DB_ERROR",
        db_acquire_ms: Number(acquireMs.toFixed(3)),
        db_query_ms: Number(queryMs.toFixed(3)),
        db_total_ms: Number(totalMs.toFixed(3)),
        sql: safeSql(sql),
      })
    );

    throw e;
  } finally {
    try { if (conn) conn.release(); } catch {}
  }
}

/** req에 reqId 없을 때 쓰는 간단 생성기 */
function genReqId() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2));
}

module.exports = { pool, timedQuery, genReqId };

