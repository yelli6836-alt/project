const router = require("express").Router();
const { pool } = require("../db");
const asyncWrap = require("../utils/asyncWrap");

// GET /reviews/summary?item_ids=100000,99999,99998
router.get("/summary", asyncWrap(async (req, res) => {
  const raw = String(req.query.item_ids || "").trim();
  if (!raw) return res.status(400).json({ ok: false, error: "MISSING_ITEM_IDS" });

  const itemIds = raw
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!itemIds.length) return res.status(400).json({ ok: false, error: "INVALID_ITEM_IDS" });
  if (itemIds.length > 200) return res.status(400).json({ ok: false, error: "TOO_MANY_ITEM_IDS", max: 200 });

  const placeholders = itemIds.map(() => "?").join(", ");

  const [rows] = await pool.query(
    `SELECT item_id,
            COUNT(*) AS review_count,
            AVG(star_score) AS avg_rating
     FROM item_review
     WHERE item_id IN (${placeholders})
     GROUP BY item_id`,
    itemIds
  );

  res.json({ ok: true, items: rows });
}));

// GET /reviews/:itemId/summary
router.get("/:itemId/summary", asyncWrap(async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ ok: false, error: "INVALID_ITEM_ID" });
  }

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS review_count, AVG(star_score) AS avg_rating
     FROM item_review
     WHERE item_id = ?`,
    [itemId]
  );

  const summary = rows[0] || { review_count: 0, avg_rating: null };
  res.json({ ok: true, item_id: itemId, summary });
}));

// GET /reviews?item_id=100000&page=1&size=20
router.get("/", asyncWrap(async (req, res) => {
  const itemId = Number(req.query.item_id);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ ok: false, error: "MISSING_OR_INVALID_ITEM_ID" });
  }

  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(50, Math.max(1, Number(req.query.size || 20)));
  const offset = (page - 1) * size;

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM item_review
     WHERE item_id = ?`,
    [itemId]
  );

  const [rows] = await pool.query(
    `SELECT customer_id, star_score, review_contents, created_at
     FROM item_review
     WHERE item_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [itemId, size, offset]
  );

  res.json({
    ok: true,
    item_id: itemId,
    page,
    size,
    total: countRow.total,
    reviews: rows,
  });
}));

module.exports = router;
