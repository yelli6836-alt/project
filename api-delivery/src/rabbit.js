const amqp = require("amqplib");
const { rabbit } = require("./config");

async function connect() {
  if (!rabbit.url) throw new Error("MQ_DISABLED");
  const conn = await amqp.connect(rabbit.url);
  const ch = await conn.createChannel();

  await ch.assertExchange(rabbit.exchange, "topic", { durable: true });
  await ch.assertQueue(rabbit.queue, { durable: true });
  await ch.bindQueue(rabbit.queue, rabbit.exchange, rabbit.routingKey);

  ch.prefetch(10);
  return { conn, ch };
}

module.exports = { connect };
