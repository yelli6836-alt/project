const router = require("express").Router();
const asyncWrap = require("../utils/asyncWrap");
const ctrl = require("../controllers/payments.controller");

router.post("/approve", asyncWrap(ctrl.approve));
router.post("/test-publish", asyncWrap(ctrl.testPublish));

module.exports = router;
