const jwt = require("jsonwebtoken");
const { jwt: jwtCfg } = require("../config");

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const [type, token] = h.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ ok: false, error: "NO_TOKEN" });
  }

  try {
    const payload = jwt.verify(token, jwtCfg.secret);
    req.user = payload; // { customer_id, email }
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
}

module.exports = { authMiddleware };
