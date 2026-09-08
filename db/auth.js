const crypto = require("crypto");
const pool = require("./pool");

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

async function createUser(username, password, opts) {
  const name = normalizeUsername(username);
  const o = opts || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO users
         (username, password_hash, stripe_customer_id, stripe_payment_method_id, avatar_data, avatar_mime)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email_verified`,
      [
        name, hashPassword(password),
        o.stripeCustomerId || null, o.stripePaymentMethodId || null,
        o.avatarData || null, o.avatarMime || null
      ]
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
    `SELECT id, username, password_hash, email_verified, (avatar_mime IS NOT NULL) AS has_avatar
       FROM users WHERE lower(username) = lower($1)`,
    [normalizeUsername(username)]
  );
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return {
    id: user.id,
    username: user.username,
    emailVerified: user.email_verified,
    has_avatar: user.has_avatar
  };
}

// Looks a user up by email/username without checking a password. Used by the
// "resend verification" flow.
async function getUserByUsername(username) {
  const { rows } = await pool.query(
    "SELECT id, username, email_verified FROM users WHERE lower(username) = lower($1)",
    [normalizeUsername(username)]
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, username: rows[0].username, emailVerified: rows[0].email_verified };
}

// Issues a fresh verification token, invalidating any earlier one for the user.
async function createEmailVerification(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  await pool.query("DELETE FROM email_verifications WHERE user_id = $1", [userId]);
  await pool.query(
    "INSERT INTO email_verifications (token, user_id, expires_at) VALUES ($1, $2, $3)",
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

// Redeems a token: marks the user verified and clears their tokens. Returns the
// user id on success, or null if the token is unknown or expired.
async function consumeEmailVerification(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    "SELECT user_id FROM email_verifications WHERE token = $1 AND expires_at > now()",
    [token]
  );
  const row = rows[0];
  if (!row) return null;
  await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [row.user_id]);
  await pool.query("DELETE FROM email_verifications WHERE user_id = $1", [row.user_id]);
  return row.user_id;
}

async function deleteExpiredEmailVerifications() {
  await pool.query("DELETE FROM email_verifications WHERE expires_at <= now()");
}

async function getStripeCustomerId(userId) {
  const { rows } = await pool.query(
    "SELECT stripe_customer_id FROM users WHERE id = $1",
    [userId]
  );
  return rows[0] ? rows[0].stripe_customer_id : null;
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
    `SELECT u.id, u.username, (u.avatar_mime IS NOT NULL) AS has_avatar
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now() AND u.email_verified`,
    [token]
  );
  return rows[0] || null;
}

async function getAvatar(userId) {
  const { rows } = await pool.query(
    "SELECT avatar_data, avatar_mime FROM users WHERE id = $1",
    [userId]
  );
  if (!rows[0] || !rows[0].avatar_data) return null;
  return { data: rows[0].avatar_data, mime: rows[0].avatar_mime };
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
  getUserByUsername,
  createSession,
  getSessionUser,
  deleteSession,
  deleteExpiredSessions,
  createEmailVerification,
  consumeEmailVerification,
  deleteExpiredEmailVerifications,
  getStripeCustomerId,
  getAvatar
};
