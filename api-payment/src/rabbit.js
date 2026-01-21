const amqp = require("amqplib");
const { rabbit } = require("./config");

let conn, ch;

async function initRabbit() {
  if (!rabbit.url) return null; // MQ 비활성 허용
  conn = await amqp.connect(rabbit.url);
  ch = await conn.createChannel();
  await ch.assertExchange(rabbit.exchange, rabbit.exchangeType, { durable: true });
  return ch;
}

async function publish(routingKey, payload) {
  if (!rabbit.url) throw new Error("MQ_DISABLED");
  if (!ch) throw new Error("MQ_NOT_INITIALIZED");
  const buf = Buffer.from(JSON.stringify(payload));
  ch.publish(rabbit.exchange, routingKey, buf, { contentType: "application/json", persistent: true });
  return true;
}

async function closeRabbit() {
  try { if (ch) await ch.close(); } catch {}
  try { if (conn) await conn.close(); } catch {}
  ch = null; conn = null;
}

module.exports = { initRabbit, publish, closeRabbit };
