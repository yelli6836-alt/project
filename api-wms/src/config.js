require("dotenv").config();

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

module.exports = {
  port: Number(process.env.PORT || 3002),
  db: {
    host: must("DB_HOST"),
    port: Number(process.env.DB_PORT || 3306),
    user: must("DB_USER"),
    password: must("DB_PASS"),
    database: must("DB_NAME"),
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
  },
  rabbit: {
    url: must("RABBITMQ_URL"),
    exchange: must("RABBITMQ_EXCHANGE"),
    exchangeType: process.env.RABBITMQ_EXCHANGE_TYPE || "topic",
    queue: must("RABBITMQ_QUEUE"),
    routingKey: must("RABBITMQ_ROUTING_KEY"),
  },
  wms: {
    deductPlaceId: Number(process.env.WMS_DEDUCT_PLACE_ID || 1001),
  },
};
