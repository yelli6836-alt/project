const { app } = require("./app");
const { port } = require("./config");
const { pool } = require("./db");
const { initRabbit } = require("./rabbit");

async function start() {
  await pool.query("SELECT 1");
  await initRabbit().catch(() => null); // MQ 없어도 서버는 뜨게

  app.listen(port, "0.0.0.0", () => {
    console.log("[api-payment] listening on :" + port);
  });
}

start().catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});
