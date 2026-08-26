const { parseCsv } = require("./csv");

function normalizeHeader(h) {
  return h.trim().toLowerCase();
}

// Order matters: more specific matchers run first and claim their column so
// generic matchers (e.g. "muscle") don't steal a more specific one first
// (e.g. "skeletal muscle").
const FIELD_MATCHERS = [
  { key: "bmi", match: (h) => h.includes("bmi") },
  { key: "bmr", match: (h) => h.includes("bmr") || h.includes("basal metabolic") },
  { key: "visceralFat", match: (h) => h.includes("visceral") },
  { key: "subcutaneousFatPct", match: (h) => h.includes("subcutaneous") },
  { key: "skeletalMusclePct", match: (h) => h.includes("skeletal") },
  { key: "metabolicAge", match: (h) => h.includes("metabolic age") },
  {
    key: "fatFreeWeightLb",
    match: (h) => h.includes("fat-free") || h.includes("fat free") || h.includes("lean body mass") || h.includes("lean mass") || h.includes("ffm"),
    isWeight: true
  },
  { key: "bodyWaterPct", match: (h) => h.includes("water") },
  { key: "boneMassLb", match: (h) => h.includes("bone"), isWeight: true },
  { key: "proteinPct", match: (h) => h.includes("protein") },
  { key: "musclePct", match: (h) => h.includes("muscle") },
  { key: "bodyFatPct", match: (h) => h.includes("body fat") },
  { key: "bodyFatPct", match: (h) => h.includes("fat") },
  { key: "weightLb", match: (h) => h.includes("weight"), isWeight: true }
];

function parseFlexibleDate(raw) {
  if (!raw) return null;
  const str = raw.trim().split(/\s+/)[0]; // drop any time-of-day suffix

  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;

  m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;

  return null;
}

function parseNumber(raw) {
  if (raw == null || raw.trim() === "") return null;
  const n = parseFloat(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function importMetricsCsv(csvText) {
  const table = parseCsv(csvText);
  if (table.length < 2) {
    return { matchedColumns: {}, entries: [], skipped: [], error: "CSV has no data rows" };
  }

  const rawHeaders = table[0];
  const headers = rawHeaders.map(normalizeHeader);
  const usedIdx = new Set();

  const dateIdx = (() => {
    const byDate = headers.findIndex((h) => h.includes("date"));
    if (byDate !== -1) return byDate;
    return headers.findIndex((h) => h.includes("time"));
  })();
  if (dateIdx !== -1) usedIdx.add(dateIdx);

  const columnIdxByKey = {};
  const columnIsKgByKey = {};

  for (const matcher of FIELD_MATCHERS) {
    if (columnIdxByKey[matcher.key] !== undefined) continue; // already matched by an earlier, more specific rule
    for (let i = 0; i < headers.length; i++) {
      if (usedIdx.has(i)) continue;
      if (matcher.match(headers[i])) {
        columnIdxByKey[matcher.key] = i;
        columnIsKgByKey[matcher.key] = matcher.isWeight && headers[i].includes("kg");
        usedIdx.add(i);
        break;
      }
    }
  }

  const matchedColumns = {};
  for (const key of Object.keys(columnIdxByKey)) {
    matchedColumns[key] = rawHeaders[columnIdxByKey[key]];
  }
  if (dateIdx !== -1) matchedColumns.date = rawHeaders[dateIdx];

  const hasAnyMetricColumn = Object.keys(columnIdxByKey).length > 0;
  if (dateIdx === -1 || !hasAnyMetricColumn) {
    return {
      matchedColumns,
      entries: [],
      skipped: [],
      error: "Could not find a date column and at least one recognizable metric column. Found headers: " + rawHeaders.join(", ")
    };
  }

  const entries = [];
  const skipped = [];

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const rawDate = row[dateIdx];
    const date = parseFlexibleDate(rawDate);
    if (!date) {
      skipped.push({ row: r + 1, reason: `Unparseable date: "${rawDate}"` });
      continue;
    }

    const entry = { date };
    let hasAnyValue = false;

    for (const key of Object.keys(columnIdxByKey)) {
      let value = parseNumber(row[columnIdxByKey[key]]);
      if (value != null && columnIsKgByKey[key]) value = value * 2.20462;
      entry[key] = value;
      if (value != null) hasAnyValue = true;
    }

    if (!hasAnyValue) {
      skipped.push({ row: r + 1, reason: "No usable metric values" });
      continue;
    }

    entries.push(entry);
  }

  return { matchedColumns, entries, skipped };
}

module.exports = { importMetricsCsv, parseFlexibleDate, parseNumber };
