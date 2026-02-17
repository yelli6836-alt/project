const router = require("express").Router();

router.get("/", (req, res) => {
  res.json({ ok: true, service: process.env.SERVICE_NAME || "api-web" });
});

module.exports = router;
