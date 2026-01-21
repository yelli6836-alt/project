const router = require("express").Router();
const { pool } = require("../db");
const asyncWrap = require("../utils/asyncWrap");

// ---------- helpers ----------
function toInt(v, def) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : def;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
// 데모에서 "무조건 200" 필요하면 DEMO_HTTP200=true
function isDemo200() {
  return String(process.env.DEMO_HTTP200 || "").toLowerCase() === "true";
}
function send(res, status, body) {
  return res.status(isDemo200() ? 200 : status).json(body);
}

// GET /products?category_id=&q=&page=&size=&status=
router.get(
  "/",
  asyncWrap(async (req, res) => {
    // ✅ 안전 파싱 (NaN 방지)
    const categoryId = toInt(req.query.category_id, null); // null or int
    const q = req.query.q ? String(req.query.q).trim() : null;
    const status = req.query.status ? String(req.query.status).trim() : null;

    const page = clamp(toInt(req.query.page, 1), 1, 1000000);
    const size = clamp(toInt(req.query.size, 20), 1, 50);
    const offset = (page - 1) * size;

    const where = [];
    const params = { limit: size, offset };

    // ✅ categoryId는 "정수 && 1 이상"일 때만 조건에 넣기
    if (Number.isFinite(categoryId) && categoryId > 0) {
      where.push("i.category_id = :categoryId");
      params.categoryId = categoryId;
    }

    // ✅ status는 허용값 있으면 여기서 화이트리스트 해도 됨(데모면 일단 문자열만)
    if (status) {
      where.push("i.status = :status");
      params.status = status;
    }

    if (q) {
      where.push("MATCH(i.item_name, i.item_desc) AGAINST(:q IN BOOLEAN MODE)");
      params.q = q + "*";
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    try {
      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total
           FROM item i
           ${whereSql}`,
        params
      );

      const [rows] = await pool.query(
        `SELECT i.item_id, i.category_id, i.item_name, i.base_cost, i.status, i.created_at,
                c.category_name
           FROM item i
           JOIN category c ON c.category_id = i.category_id
           ${whereSql}
          ORDER BY i.item_id DESC
          LIMIT :limit OFFSET :offset`,
        params
      );

      return send(res, 200, {
        ok: true,
        page,
        size,
        total: countRows?.[0]?.total ?? 0,
        items: rows || [],
      });
    } catch (e) {
      // ✅ 데모 안정화: 최소한 JSON은 항상 내려주기
      return send(res, 500, {
        ok: false,
        error: "INTERNAL_ERROR",
        message: e?.message || String(e),
      });
    }
  })
);

router.get(
  "/:itemId",
  asyncWrap(async (req, res) => {
    const itemId = toInt(req.params.itemId, null);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return send(res, 400, { ok: false, error: "INVALID_ITEM_ID" });
    }

    const [rows] = await pool.query(
      `SELECT i.item_id, i.category_id, i.item_name, i.base_cost, i.item_desc, i.status, i.created_at,
              c.category_name
         FROM item i
         JOIN category c ON c.category_id = i.category_id
        WHERE i.item_id = ?`,
      [itemId]
    );

    if (!rows.length) return send(res, 404, { ok: false, error: "ITEM_NOT_FOUND" });
    return send(res, 200, { ok: true, item: rows[0] });
  })
);

router.get(
  "/:itemId/images",
  asyncWrap(async (req, res) => {
    const itemId = toInt(req.params.itemId, null);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return send(res, 400, { ok: false, error: "INVALID_ITEM_ID" });
    }

    const [rows] = await pool.query(
      `SELECT image_id, item_id, url, display_order, created_at
         FROM item_image
        WHERE item_id = ?
        ORDER BY display_order IS NULL, display_order ASC, image_id ASC`,
      [itemId]
    );
    return send(res, 200, { ok: true, images: rows || [] });
  })
);

router.get(
  "/:itemId/options",
  asyncWrap(async (req, res) => {
    const itemId = toInt(req.params.itemId, null);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return send(res, 400, { ok: false, error: "INVALID_ITEM_ID" });
    }

    const [rows] = await pool.query(
      `SELECT option_id, item_id, option_name, option_value, add_cost, skuid, created_at
         FROM item_option
        WHERE item_id = ?
        ORDER BY option_id ASC`,
      [itemId]
    );
    return send(res, 200, { ok: true, options: rows || [] });
  })
);

module.exports = router;

