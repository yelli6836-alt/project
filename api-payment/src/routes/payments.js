const router = require("express").Router();
const asyncWrap = require("../utils/asyncWrap");
const ctrl = require("../controllers/payments.controller");

router.get("/ping-db", asyncWrap(ctrl.pingDb));
router.post("/test-publish", asyncWrap(ctrl.testPublish));
router.post("/approve", asyncWrap(ctrl.approve));

module.exports = router;
