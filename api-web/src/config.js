require("dotenv").config();

function getBaseUrl(envKeys, fallback) {
  for (const k of envKeys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return fallback;
}
function normBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

module.exports = {
  port: Number(process.env.PORT || 3010),

  // Downstream service base URLs (Docker Compose defaults are service-name DNS)
  services: {
    product: normBase(getBaseUrl(["PRODUCT_API_BASE", "PRODUCT_API_BASE_URL"], "http://api-product:3005")),
    cart: normBase(getBaseUrl(["CART_API_BASE", "CART_API_BASE_URL"], "http://api-cart:3007")),
    order: normBase(getBaseUrl(["ORDER_API_BASE", "ORDER_API_BASE_URL"], "http://api-order:3008")),
    delivery: normBase(getBaseUrl(["DELIVERY_API_BASE", "DELIVERY_API_BASE_URL"], "http://api-delivery:3003")),
    payment: normBase(getBaseUrl(["PAYMENT_API_BASE", "PAYMENT_API_BASE_URL"], "http://api-payment:3001")),
    review: normBase(getBaseUrl(["REVIEW_API_BASE", "REVIEW_API_BASE_URL"], "http://api-review:3009")),
    customer: normBase(getBaseUrl(["CUSTOMER_API_BASE", "CUSTOMER_API_BASE_URL"], "http://api-customer:3006")),
  },

  http: {
    timeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 5000),
  },
};
