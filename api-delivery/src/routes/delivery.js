const router = require("express").Router();
const asyncWrap = require("../utils/asyncWrap");
const ctrl = require("../controllers/delivery.controller");

// ✅ alias 추가(선택이지만 강추): /delivery prefix가 붙어서 들어오는 경우 대비
router.get(["/orders/:orderNumber", "/delivery/orders/:orderNumber"], asyncWrap(ctrl.getOrder));
router.patch(["/orders/:orderNumber/status", "/delivery/orders/:orderNumber/status"], asyncWrap(ctrl.updateStatus));

module.exports = router;

