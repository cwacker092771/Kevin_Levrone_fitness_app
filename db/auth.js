const crypto = require("crypto");
const pool = require("./pool");

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Password hashing uses Node's built-in scrypt so there are no native
// dependencies. Stored format: "scrypt$<saltHex>$<hashHex>".
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Usernames are email addresses; store and match them lower-cased so
// "User@x.com" and "user@x.com" are the same account.
function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

async function createUser(username, password) {
  const name = normalizeUsername(username);
  try {
    const { rows } = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [name, hashPassword(password)]
    );
    return rows[0];
  } catch (err) {
    if (err.code === "23505") {
      const e = new Error("username_taken");
      e.code = "username_taken";
      throw e;
    }
    throw err;
  }
}

async function verifyUser(username, password) {
  const { rows } = await pool.query(
    "SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)",
    [normalizeUsername(username)]
  );
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, username: user.username };
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

async function getSessionUser(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows[0] || null;
}

async function deleteSession(token) {
  if (!token) return;
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

async function deleteExpiredSessions() {
  await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
}

module.exports = {
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  createUser,
  verifyUser,
  createSession,
  getSessionUser,
  deleteSession,
  deleteExpiredSessions
};
