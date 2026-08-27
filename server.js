const express = require("express");
const path = require("path");
const fs = require("fs");
const pool = require("./db/pool");
const plans = require("./db/plans");
const metrics = require("./db/metrics");
const notes = require("./db/notes");
const { importMetricsCsv } = require("./lib/importMetricsCsv");
const { BODY_METRIC_FIELDS } = require("./lib/bodyMetricFields");

const app = express();
const PORT = process.env.PORT || 3000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

function isValidDate(str) {
  return DATE_RE.test(str) && !Number.isNaN(Date.parse(str));
}

app.get("/api/plans/dates", async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: "invalid_year_or_month" });
  }
  try {
    const dates = await plans.getPlanDatesInMonth(year, month);
    res.json({ dates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/plans/:date", async (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: "invalid_date" });
  try {
    const plan = await plans.getPlan(date);
    if (!plan) return res.status(404).json({ error: "not_found" });
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/plans/:date", async (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: "invalid_date" });
  const { inputs, stats, groups } = req.body || {};
  if (!inputs || !stats || !Array.isArray(groups)) {
    return res.status(400).json({ error: "missing_fields" });
  }
  try {
    const plan = await plans.upsertPlan(date, inputs, stats, groups);
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.patch("/api/plans/:date/items/:itemId", async (req, res) => {
  const { date, itemId } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: "invalid_date" });
  if (typeof req.body?.checked !== "boolean") {
    return res.status(400).json({ error: "missing_checked" });
  }
  try {
    const plan = await plans.setItemChecked(date, itemId, req.body.checked);
    if (!plan) return res.status(404).json({ error: "not_found" });
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/plans/:date/reset-checked", async (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: "invalid_date" });
  try {
    const plan = await plans.resetChecked(date);
    if (!plan) return res.status(404).json({ error: "not_found" });
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/metrics", async (req, res) => {
  try {
    const list = await metrics.listMetrics();
    res.json({ metrics: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/metrics/:date", async (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: "invalid_date" });
  try {
    const metric = await metrics.getMetric(date);
    if (!metric) return res.status(404).json({ error: "not_found" });
    res.json(metric);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/metrics/import-csv", async (req, res) => {
  const { csv } = req.body || {};
  if (typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ error: "missing_csv" });
  }

  const result = importMetricsCsv(csv);
  if (result.error) {
    return res.status(422).json({ error: result.error, matchedColumns: result.matchedColumns });
  }

  try {
    for (const entry of result.entries) {
      await metrics.upsertMetric(entry.date, entry);
    }
    res.json({
      matchedColumns: result.matchedColumns,
      imported: result.entries.length,
      skipped: result.skipped
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/metrics/:date", async (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: "invalid_date" });
  const data = req.body || {};
  const hasAnyValue = BODY_METRIC_FIELDS.some((f) => data[f.key] != null);
  if (!hasAnyValue) {
    return res.status(400).json({ error: "missing_fields" });
  }
  try {
    const metric = await metrics.upsertMetric(date, data);
    res.json(metric);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/notes/dates", async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: "invalid_year_or_month" });
  }
  try {
    const dates = await notes.getNoteDatesInMonth(year, month);
    res.json({ dates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/notes/:date", async (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: "invalid_date" });
  try {
    const note = await notes.getNote(date);
    res.json(note || { date, note: "", updatedAt: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/notes/:date", async (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: "invalid_date" });
  if (typeof req.body?.note !== "string") {
    return res.status(400).json({ error: "missing_note" });
  }
  try {
    const note = await notes.upsertNote(date, req.body.note);
    res.json(note);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

async function start() {
  const schemaSql = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(schemaSql);
  app.listen(PORT, () => {
    console.log(`Levrone Protocol server running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
