// api-delivery/src/routes/delivery.js
const router = require("express").Router();
const asyncWrap = require("../utils/asyncWrap");
const ctrl = require("../controllers/delivery.controller");

// ✅ Kong strip-path=true 환경 + /delivery prefix 유입 대비 alias
router.get(
  ["/orders/:orderNumber", "/delivery/orders/:orderNumber"],
  asyncWrap(ctrl.getOrder)
);

router.patch(
  ["/orders/:orderNumber/status", "/delivery/orders/:orderNumber/status"],
  asyncWrap(ctrl.updateStatus)
);

module.exports = router;

