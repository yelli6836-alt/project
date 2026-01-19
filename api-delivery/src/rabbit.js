const amqp = require("amqplib");
const { rabbit } = require("./config");

async function connect() {
  const conn = await amqp.connect(rabbit.url);
  const ch = await conn.createChannel();

  await ch.assertExchange(rabbit.exchange, rabbit.exchangeType, { durable: true });
  await ch.assertQueue(rabbit.queue, { durable: true });
  await ch.bindQueue(rabbit.queue, rabbit.exchange, rabbit.routingKey);

  ch.prefetch(10);
  return { conn, ch };
}

module.exports = { connect };
