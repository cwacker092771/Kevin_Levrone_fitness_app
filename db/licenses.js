const pool = require("./pool");
const { LICENSE_TIER_IDS, ADDITIONAL_SERVICE_IDS } = require("../lib/licenseTiers");

function serializeRow(row) {
  if (!row) return null;
  return { tier: row.tier, addon: row.addon || null, activatedAt: row.activated_at };
}

// Returns the user's active license, or null if they have not chosen a tier.
async function getLicense(userId) {
  const { rows } = await pool.query(
    "SELECT tier, addon, activated_at FROM licenses WHERE user_id = $1",
    [userId]
  );
  return serializeRow(rows[0]);
}

// Installs (or switches) the user's license to the given tier, plus an optional
// coaching add-on (pass null / undefined for none).
async function setLicense(userId, tier, addon) {
  if (!LICENSE_TIER_IDS.includes(tier)) {
    const e = new Error("invalid_tier");
    e.code = "invalid_tier";
    throw e;
  }
  const addonId = addon || null;
  if (addonId !== null && !ADDITIONAL_SERVICE_IDS.includes(addonId)) {
    const e = new Error("invalid_addon");
    e.code = "invalid_addon";
    throw e;
  }
  const { rows } = await pool.query(
    `INSERT INTO licenses (user_id, tier, addon, activated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id)
     DO UPDATE SET tier = $2, addon = $3, activated_at = now()
     RETURNING tier, addon, activated_at`,
    [userId, tier, addonId]
  );
  return serializeRow(rows[0]);
}

module.exports = { getLicense, setLicense };
