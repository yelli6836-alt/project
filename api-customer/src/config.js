require("dotenv").config();
function must(name) { const v = process.env[name]; if (!v) throw new Error(`Missing env: ${name}`); return v; }

module.exports = {
  port: Number(process.env.PORT || 3006),
  authMode: String(process.env.AUTH_MODE || "verify").toLowerCase(),
  db: {
    host: must("DB_HOST"),
    port: Number(process.env.DB_PORT || 3306),
    user: must("DB_USER"),
    password: must("DB_PASS"),
    database: must("DB_NAME"),
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || "",
    expiresIn: process.env.JWT_EXPIRES_IN || "2h",
  },
};
