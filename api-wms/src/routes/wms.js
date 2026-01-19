const router = require("express").Router();
const asyncWrap = require("../utils/asyncWrap");
const { getStockBySkuid } = require("../controllers/wms.controller");

router.get("/stock/:skuid", asyncWrap(getStockBySkuid));

module.exports = router;
