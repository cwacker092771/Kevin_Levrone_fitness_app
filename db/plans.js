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

async function getPlan(date) {
  const { rows } = await pool.query(
    "SELECT * FROM daily_plans WHERE plan_date = $1",
    [date]
  );
  return serializeRow(rows[0]);
}

async function upsertPlan(date, inputs, stats, groups) {
  const existing = await pool.query(
    "SELECT checked FROM daily_plans WHERE plan_date = $1",
    [date]
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
    `INSERT INTO daily_plans (plan_date, inputs, stats, groups, checked, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (plan_date)
     DO UPDATE SET inputs = $2, stats = $3, groups = $4, checked = $5, updated_at = now()
     RETURNING *`,
    [date, JSON.stringify(inputs), JSON.stringify(stats), JSON.stringify(groups), JSON.stringify(checked)]
  );
  return serializeRow(rows[0]);
}

async function setItemChecked(date, itemId, checkedValue) {
  const { rows } = await pool.query(
    `UPDATE daily_plans
     SET checked = jsonb_set(checked, ARRAY[$2::text], to_jsonb($3::boolean), true),
         updated_at = now()
     WHERE plan_date = $1
     RETURNING *`,
    [date, itemId, checkedValue]
  );
  return serializeRow(rows[0]);
}

async function resetChecked(date) {
  const { rows } = await pool.query(
    `UPDATE daily_plans
     SET checked = '{}'::jsonb, updated_at = now()
     WHERE plan_date = $1
     RETURNING *`,
    [date]
  );
  return serializeRow(rows[0]);
}

async function getPlanDatesInMonth(year, month) {
  const { rows } = await pool.query(
    `SELECT plan_date FROM daily_plans
     WHERE date_trunc('month', plan_date) = date_trunc('month', $1::date)`,
    [`${year}-${String(month).padStart(2, "0")}-01`]
  );
  return rows.map((r) => r.plan_date.toISOString().slice(0, 10));
}

module.exports = { getPlan, upsertPlan, setItemChecked, resetChecked, getPlanDatesInMonth };
