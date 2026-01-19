const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.pass,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: config.db.poolLimit,
  queueLimit: 0,
});

async function pingDb() {
  const [rows] = await pool.query("SELECT 1 AS ok");
  return rows && rows[0] && rows[0].ok === 1;
}

module.exports = { pool, pingDb };
