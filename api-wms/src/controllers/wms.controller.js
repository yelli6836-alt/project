const { pool } = require("../db");

// GET /wms/stock/:skuid
async function getStockBySkuid(req, res) {
  const skuid = String(req.params.skuid || "").trim();
  if (!skuid) return res.status(400).json({ ok: false, error: "MISSING_SKUID" });

  const [skuRows] = await pool.query(
    `SELECT skuid, sku_name
       FROM sku_master
      WHERE skuid = :skuid
      LIMIT 1`,
    { skuid }
  );
  if (!skuRows.length) return res.status(404).json({ ok: false, error: "SKUID_NOT_FOUND" });

  const [[sumRow]] = await pool.query(
    `SELECT COALESCE(SUM(qty), 0) AS total_qty
       FROM inventory
      WHERE skuid = :skuid`,
    { skuid }
  );

  const [topPlaces] = await pool.query(
    `SELECT place_id, qty
       FROM inventory
      WHERE skuid = :skuid
      ORDER BY qty DESC
      LIMIT 5`,
    { skuid }
  );

  res.json({
    ok: true,
    skuid: skuRows[0].skuid,
    skuName: skuRows[0].sku_name,
    totalQty: Number(sumRow.total_qty || 0),
    topPlaces: topPlaces.map((r) => ({ place_id: r.place_id, qty: Number(r.qty || 0) })),
  });
}

module.exports = { getStockBySkuid };
