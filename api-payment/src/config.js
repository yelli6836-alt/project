require("dotenv").config();

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[config] missing env: ${name}`);
  return v;
}

module.exports = {
  port: Number(process.env.PORT || 3001),
  db: {
    host: must("DB_HOST"),
    port: Number(process.env.DB_PORT || 3306),
    user: must("DB_USER"),
    pass: must("DB_PASS"),
    name: must("DB_NAME"),
    poolLimit: Number(process.env.DB_POOL_LIMIT || 10),
  },
  rabbit: {
    url: must("RABBITMQ_URL"),
    exchange: process.env.RABBITMQ_EXCHANGE || "mall.events",
    exchangeType: process.env.RABBITMQ_EXCHANGE_TYPE || "topic",
    routingKey: process.env.RABBITMQ_ROUTING_KEY || "payment.order.paid",
  },
};
