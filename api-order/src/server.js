const { app } = require("./app");
const { port } = require("./config");
const { pool } = require("./db");

async function start() {
  await pool.query("SELECT 1");
  app.listen(port, "0.0.0.0", () => {
    console.log(`[api-order] listening on :${port}`);
  });
}

start().catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});
