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

async function upsertMetric(date, data) {
  const columns = BODY_METRIC_FIELDS.map((f) => f.column);
  const values = BODY_METRIC_FIELDS.map((f) => (data[f.key] == null ? null : data[f.key]));

  const placeholders = values.map((_, i) => `$${i + 2}`);
  const updateAssignments = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");

  const { rows } = await pool.query(
    `INSERT INTO body_metrics (metric_date, ${columns.join(", ")}, updated_at)
     VALUES ($1, ${placeholders.join(", ")}, now())
     ON CONFLICT (metric_date)
     DO UPDATE SET ${updateAssignments}, updated_at = now()
     RETURNING *`,
    [date, ...values]
  );
  return serializeRow(rows[0]);
}

async function getMetric(date) {
  const { rows } = await pool.query(
    "SELECT * FROM body_metrics WHERE metric_date = $1",
    [date]
  );
  return serializeRow(rows[0]);
}

async function listMetrics() {
  const { rows } = await pool.query(
    "SELECT * FROM body_metrics ORDER BY metric_date ASC"
  );
  return rows.map(serializeRow);
}

module.exports = { upsertMetric, getMetric, listMetrics };
