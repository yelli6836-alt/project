const router = require("express").Router();
const asyncWrap = require("../utils/asyncWrap");
const ctrl = require("../controllers/delivery.controller");

router.get("/orders/:orderNumber", asyncWrap(ctrl.getOrder));
router.patch("/orders/:orderNumber/status", asyncWrap(ctrl.updateStatus));

module.exports = router;
