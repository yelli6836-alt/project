const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const asyncWrap = require("../utils/asyncWrap");
const { jwt: jwtCfg } = require("../config");

// POST /auth/register : { email, name, password }
router.post("/register", asyncWrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");

  if (!email || !name || password.length < 6) {
    return res.status(400).json({ ok: false, error: "INVALID_INPUT" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [exists] = await conn.query(
      "SELECT customer_id FROM customers WHERE customer_email = ? LIMIT 1",
      [email]
    );
    if (exists.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, error: "EMAIL_ALREADY_EXISTS" });
    }

    const [r1] = await conn.query(
      "INSERT INTO customers (customer_email, customer_name) VALUES (?, ?)",
      [email, name]
    );
    const customerId = r1.insertId;

    const passwordHash = await bcrypt.hash(password, 12);
    await conn.query(
      "INSERT INTO customer_auth (customer_id, password_hash) VALUES (?, ?)",
      [customerId, passwordHash]
    );

    await conn.commit();

    res.status(201).json({
      ok: true,
      customer: { customer_id: customerId, customer_email: email, customer_name: name },
    });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}));

// POST /auth/login : { email, password } -> JWT
router.post("/login", asyncWrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "INVALID_INPUT" });
  }

  const [rows] = await pool.query(
    `SELECT c.customer_id, c.customer_email, c.customer_name, a.password_hash
       FROM customers c
       JOIN customer_auth a ON a.customer_id = c.customer_id
      WHERE c.customer_email = ?
      LIMIT 1`,
    [email]
  );

  if (!rows.length) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

  const u = rows[0];
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

  const token = jwt.sign(
    { customer_id: u.customer_id, email: u.customer_email },
    jwtCfg.secret,
    { expiresIn: jwtCfg.expiresIn }
  );

  res.json({
    ok: true,
    token,
    customer: {
      customer_id: u.customer_id,
      customer_email: u.customer_email,
      customer_name: u.customer_name,
    },
  });
}));

router.post("/logout", (req, res) => {
  res.json({ ok: true, message: "client_should_delete_token" });
});

module.exports = router;
