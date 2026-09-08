const pool = require("./pool");
const { LICENSE_TIER_IDS, ADDITIONAL_SERVICE_IDS } = require("../lib/licenseTiers");

function serializeRow(row) {
  if (!row) return null;
  return {
    tier: row.tier,
    addon: row.addon || null,
    status: row.status || "active",
    activatedAt: row.activated_at,
    canceledAt: row.canceled_at || null
  };
}

// Returns the user's license (active or canceled), or null if they have not
// chosen a tier.
async function getLicense(userId) {
  const { rows } = await pool.query(
    "SELECT tier, addon, status, activated_at, canceled_at FROM licenses WHERE user_id = $1",
    [userId]
  );
  return serializeRow(rows[0]);
}

// Flips an active license to canceled, keeping the row (and all the user's
// data) intact. Returns the updated license, or null if there was no active
// license to cancel.
async function cancelLicense(userId) {
  const { rows } = await pool.query(
    `UPDATE licenses SET status = 'canceled', canceled_at = now()
      WHERE user_id = $1 AND status = 'active'
      RETURNING tier, addon, status, activated_at, canceled_at`,
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
    `INSERT INTO licenses (user_id, tier, addon, status, activated_at, canceled_at)
     VALUES ($1, $2, $3, 'active', now(), NULL)
     ON CONFLICT (user_id)
     DO UPDATE SET tier = $2, addon = $3, status = 'active',
                   activated_at = now(), canceled_at = NULL
     RETURNING tier, addon, status, activated_at, canceled_at`,
    [userId, tier, addonId]
  );
  return serializeRow(rows[0]);
}

module.exports = { getLicense, setLicense, cancelLicense };
