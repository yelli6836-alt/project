const router = require("express").Router();
const { pool } = require("../db");
const asyncWrap = require("../utils/asyncWrap");
const { authMiddleware } = require("../utils/authMiddleware");

// GET /wishlist
router.get("/", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;

  const [rows] = await pool.query(
    `SELECT wishlist_id, customer_id, item_id, created_at
       FROM wishlist
      WHERE customer_id = ?
      ORDER BY wishlist_id DESC`,
    [customerId]
  );

  res.json({ ok: true, items: rows });
}));

// POST /wishlist  { item_id }
router.post("/", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  const itemId = Number(req.body.item_id);

  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ ok: false, error: "INVALID_ITEM_ID" });
  }

  // uq_wishlist(customer_id, item_id) → 중복이면 무시(멱등)
  await pool.query(
    `INSERT INTO wishlist (customer_id, item_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE created_at = created_at`,
    [customerId, itemId]
  );

  res.status(201).json({ ok: true, added: true, item_id: itemId });
}));

// DELETE /wishlist/:itemId
router.delete("/:itemId", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;
  const itemId = Number(req.params.itemId);

  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ ok: false, error: "INVALID_ITEM_ID" });
  }

  const [del] = await pool.query(
    `DELETE FROM wishlist
      WHERE customer_id = ? AND item_id = ?`,
    [customerId, itemId]
  );

  if (!del.affectedRows) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  res.json({ ok: true, deleted: true });
}));

module.exports = router;
