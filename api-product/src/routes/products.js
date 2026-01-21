const router = require("express").Router();
const { pool } = require("../db");
const asyncWrap = require("../utils/asyncWrap");

// GET /products?category_id=&q=&page=&size=&status=
router.get("/", asyncWrap(async (req, res) => {
  const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
  const q = req.query.q ? String(req.query.q).trim() : null;
  const status = req.query.status ? String(req.query.status).trim() : null;

  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(50, Math.max(1, Number(req.query.size || 20)));
  const offset = (page - 1) * size;

  const where = [];
  const params = { limit: size, offset };

  if (categoryId) { where.push("i.category_id = :categoryId"); params.categoryId = categoryId; }
  if (status) { where.push("i.status = :status"); params.status = status; }
  if (q) { where.push("MATCH(i.item_name, i.item_desc) AGAINST(:q IN BOOLEAN MODE)"); params.q = q + "*"; }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

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

  res.json({ ok: true, page, size, total: countRows[0].total, items: rows });
}));

router.get("/:itemId", asyncWrap(async (req, res) => {
  const itemId = Number(req.params.itemId);
  const [rows] = await pool.query(
    `SELECT i.item_id, i.category_id, i.item_name, i.base_cost, i.item_desc, i.status, i.created_at,
            c.category_name
       FROM item i
       JOIN category c ON c.category_id = i.category_id
      WHERE i.item_id = ?`,
    [itemId]
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: "ITEM_NOT_FOUND" });
  res.json({ ok: true, item: rows[0] });
}));

router.get("/:itemId/images", asyncWrap(async (req, res) => {
  const itemId = Number(req.params.itemId);
  const [rows] = await pool.query(
    `SELECT image_id, item_id, url, display_order, created_at
       FROM item_image
      WHERE item_id = ?
      ORDER BY display_order IS NULL, display_order ASC, image_id ASC`,
    [itemId]
  );
  res.json({ ok: true, images: rows });
}));

router.get("/:itemId/options", asyncWrap(async (req, res) => {
  const itemId = Number(req.params.itemId);
  const [rows] = await pool.query(
    `SELECT option_id, item_id, option_name, option_value, add_cost, skuid, created_at
       FROM item_option
      WHERE item_id = ?
      ORDER BY option_id ASC`,
    [itemId]
  );
  res.json({ ok: true, options: rows });
}));

module.exports = router;
