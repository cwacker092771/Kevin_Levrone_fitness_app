const pool = require("./pool");

function serializeRow(row) {
  if (!row) return null;
  return {
    date: row.plan_date instanceof Date
      ? row.plan_date.toISOString().slice(0, 10)
      : row.plan_date,
    inputs: row.inputs,
    stats: row.stats,
    groups: row.groups,
    checked: row.checked,
    updatedAt: row.updated_at
  };
}

async function getPlan(userId, date) {
  const { rows } = await pool.query(
    "SELECT * FROM daily_plans WHERE user_id = $1 AND plan_date = $2",
    [userId, date]
  );
  return serializeRow(rows[0]);
}

async function upsertPlan(userId, date, inputs, stats, groups) {
  const existing = await pool.query(
    "SELECT checked FROM daily_plans WHERE user_id = $1 AND plan_date = $2",
    [userId, date]
  );

  const validIds = new Set();
  groups.forEach((g) => g.items.forEach((i) => validIds.add(i.id)));

  let checked = {};
  if (existing.rows[0]) {
    const prev = existing.rows[0].checked || {};
    Object.keys(prev).forEach((id) => {
      if (validIds.has(id)) checked[id] = prev[id];
    });
  }

  const { rows } = await pool.query(
    `INSERT INTO daily_plans (user_id, plan_date, inputs, stats, groups, checked, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id, plan_date)
     DO UPDATE SET inputs = $3, stats = $4, groups = $5, checked = $6, updated_at = now()
     RETURNING *`,
    [userId, date, JSON.stringify(inputs), JSON.stringify(stats), JSON.stringify(groups), JSON.stringify(checked)]
  );
  return serializeRow(rows[0]);
}

async function setItemChecked(userId, date, itemId, checkedValue) {
  const { rows } = await pool.query(
    `UPDATE daily_plans
     SET checked = jsonb_set(checked, ARRAY[$3::text], to_jsonb($4::boolean), true),
         updated_at = now()
     WHERE user_id = $1 AND plan_date = $2
     RETURNING *`,
    [userId, date, itemId, checkedValue]
  );
  return serializeRow(rows[0]);
}

async function resetChecked(userId, date) {
  const { rows } = await pool.query(
    `UPDATE daily_plans
     SET checked = '{}'::jsonb, updated_at = now()
     WHERE user_id = $1 AND plan_date = $2
     RETURNING *`,
    [userId, date]
  );
  return serializeRow(rows[0]);
}

async function getPlanDatesInMonth(userId, year, month) {
  const { rows } = await pool.query(
    `SELECT plan_date FROM daily_plans
     WHERE user_id = $1
       AND date_trunc('month', plan_date) = date_trunc('month', $2::date)`,
    [userId, `${year}-${String(month).padStart(2, "0")}-01`]
  );
  return rows.map((r) => r.plan_date.toISOString().slice(0, 10));
}

module.exports = { getPlan, upsertPlan, setItemChecked, resetChecked, getPlanDatesInMonth };
