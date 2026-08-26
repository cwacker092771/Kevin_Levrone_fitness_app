const pool = require("./pool");

function serializeRow(row) {
  if (!row) return null;
  return {
    date: row.note_date instanceof Date ? row.note_date.toISOString().slice(0, 10) : row.note_date,
    note: row.note,
    updatedAt: row.updated_at
  };
}

async function getNote(date) {
  const { rows } = await pool.query(
    "SELECT * FROM daily_notes WHERE note_date = $1",
    [date]
  );
  return serializeRow(rows[0]);
}

async function upsertNote(date, note) {
  if (!note.trim()) {
    await pool.query("DELETE FROM daily_notes WHERE note_date = $1", [date]);
    return { date, note: "", updatedAt: null };
  }
  const { rows } = await pool.query(
    `INSERT INTO daily_notes (note_date, note, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (note_date)
     DO UPDATE SET note = $2, updated_at = now()
     RETURNING *`,
    [date, note]
  );
  return serializeRow(rows[0]);
}

async function getNoteDatesInMonth(year, month) {
  const { rows } = await pool.query(
    `SELECT note_date FROM daily_notes
     WHERE date_trunc('month', note_date) = date_trunc('month', $1::date)`,
    [`${year}-${String(month).padStart(2, "0")}-01`]
  );
  return rows.map((r) => r.note_date.toISOString().slice(0, 10));
}

module.exports = { getNote, upsertNote, getNoteDatesInMonth };
