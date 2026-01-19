const { pool } = require("../db");

async function getStockBySkuid(req, res) {
  const skuid = String(req.params.skuid);

  const [items] = await pool.query(
    `SELECT itemID, SKUID, item_name
       FROM item_name
      WHERE SKUID = :skuid`,
    { skuid }
  );

  if (!items.length) return res.status(404).json({ ok: false, error: "SKUID_NOT_FOUND" });

  const item = items[0];

  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(unit), 0) AS total_qty
       FROM inventory
      WHERE itemID = :itemID`,
    { itemID: item.itemID }
  );

  res.json({
    ok: true,
    skuid: item.SKUID,
    itemID: item.itemID,
    itemName: item.item_name,
    totalQty: Number(rows[0].total_qty || 0),
  });
}

module.exports = { getStockBySkuid };
