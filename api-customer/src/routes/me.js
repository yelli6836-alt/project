const router = require("express").Router();
const { pool } = require("../db");
const asyncWrap = require("../utils/asyncWrap");
const { authMiddleware } = require("../utils/authMiddleware");

router.get("/", authMiddleware, asyncWrap(async (req, res) => {
  const customerId = req.user.customer_id;

  const [rows] = await pool.query(
    "SELECT customer_id, customer_email, customer_name, created_at FROM customers WHERE customer_id = ?",
    [customerId]
  );

  if (!rows.length) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

  res.json({ ok: true, me: rows[0] });
}));

module.exports = router;
