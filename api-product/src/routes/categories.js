const router = require("express").Router();
const { pool } = require("../db");
const asyncWrap = require("../utils/asyncWrap");

router.get("/", asyncWrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT category_id, category_name
       FROM category
      ORDER BY category_id ASC`
  );
  res.json({ ok: true, categories: rows });
}));

module.exports = router;
