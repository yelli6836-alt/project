// api-payment/src/routes/payments.js
const router = require("express").Router();
const asyncWrap = require("../utils/asyncWrap");
const ctrl = require("../controllers/payments.controller");

// 요청별 DB timing ctx를 req.dbCtx에 붙여주는 미들웨어
function attachDbCtx(op) {
  return (req, res, next) => {
    // ✅ rid가 절대 "-"로 남지 않게 안전장치
    const rid =
      (req.reqId && String(req.reqId).trim()) ||
      (req.get && String(req.get("X-Request-Id") || "").trim()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // 이후 로깅/핸들러에서도 그대로 쓰게 통일
    req.reqId = rid;

    // app.js가 이미 setHeader 해도 무해(덮어쓰기 동일값)
    try { res.setHeader("X-Request-Id", rid); } catch {}

    // ✅ endpoint 정규화(쿼리스트링 제거)
    const endpoint = `${req.method} ${req.baseUrl}${req.path}`;

    req.dbCtx = {
      service: process.env.SERVICE_NAME || "api-payment",
      rid,
      endpoint,
      op, // "approve" / "test_publish"
    };

    next();
  };
}

router.post("/approve", attachDbCtx("approve"), asyncWrap(ctrl.approve));
router.post("/test-publish", attachDbCtx("test_publish"), asyncWrap(ctrl.testPublish));

module.exports = router;

