const amqplib = require("amqplib");
const config = require("./config");

let conn;
let ch;

async function initRabbit() {
  conn = await amqplib.connect(config.rabbit.url);
  ch = await conn.createChannel();

  await ch.assertExchange(config.rabbit.exchange, config.rabbit.exchangeType, { durable: true });
  return ch;
}

async function publish(routingKey, payload) {
  if (!ch) throw new Error("[rabbit] channel not initialized");
  const buf = Buffer.from(JSON.stringify(payload));
  return ch.publish(config.rabbit.exchange, routingKey, buf, {
    contentType: "application/json",
    persistent: true,
  });
}

async function closeRabbit() {
  try { if (ch) await ch.close(); } catch {}
  try { if (conn) await conn.close(); } catch {}
  ch = null;
  conn = null;
}

module.exports = { initRabbit, publish, closeRabbit };
