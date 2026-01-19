const config = require("./config");
const { createApp } = require("./app");
const { pingDb } = require("./db");
const { initRabbit, closeRabbit } = require("./rabbit");

async function bootstrap() {
  const dbOk = await pingDb();
  if (!dbOk) throw new Error("[db] ping failed");

  await initRabbit();

  const app = createApp();
  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`[api-payment] listening on :${config.port}`);
  });

  process.on("SIGINT", async () => {
    console.log("SIGINT received, shutting down...");
    server.close();
    await closeRabbit();
    process.exit(0);
  });
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
