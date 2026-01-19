const router = require("express").Router();
const { pool } = require("../db");
const asyncWrap = require("../utils/asyncWrap");

router.get("/", asyncWrap(async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true, service: "api-customer" });
}));

module.exports = router;
