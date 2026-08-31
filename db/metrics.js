const pool = require("./pool");
const { BODY_METRIC_FIELDS } = require("../lib/bodyMetricFields");

function serializeRow(row) {
  if (!row) return null;
  const result = { date: row.metric_date instanceof Date ? row.metric_date.toISOString().slice(0, 10) : row.metric_date };
  for (const field of BODY_METRIC_FIELDS) {
    const raw = row[field.column];
    result[field.key] = raw === null || raw === undefined ? null : Number(raw);
  }
  return result;
}

async function upsertMetric(userId, date, data) {
  const columns = BODY_METRIC_FIELDS.map((f) => f.column);
  const values = BODY_METRIC_FIELDS.map((f) => (data[f.key] == null ? null : data[f.key]));

  // $1 = user_id, $2 = date, $3.. = metric values
  const placeholders = values.map((_, i) => `$${i + 3}`);
  const updateAssignments = columns.map((col, i) => `${col} = $${i + 3}`).join(", ");

  const { rows } = await pool.query(
    `INSERT INTO body_metrics (user_id, metric_date, ${columns.join(", ")}, updated_at)
     VALUES ($1, $2, ${placeholders.join(", ")}, now())
     ON CONFLICT (user_id, metric_date)
     DO UPDATE SET ${updateAssignments}, updated_at = now()
     RETURNING *`,
    [userId, date, ...values]
  );
  return serializeRow(rows[0]);
}

async function getMetric(userId, date) {
  const { rows } = await pool.query(
    "SELECT * FROM body_metrics WHERE user_id = $1 AND metric_date = $2",
    [userId, date]
  );
  return serializeRow(rows[0]);
}

async function listMetrics(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM body_metrics WHERE user_id = $1 ORDER BY metric_date ASC",
    [userId]
  );
  return rows.map(serializeRow);
}

module.exports = { upsertMetric, getMetric, listMetrics };
