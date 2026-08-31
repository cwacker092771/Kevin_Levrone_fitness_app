const { getSessionUser, SESSION_TTL_MS } = require("../db/auth");

const COOKIE_NAME = "levrone_sid";

// Session cookies get the `Secure` attribute (HTTPS-only) in production. When
// the app is reached over plain HTTP (e.g. a domain-less test box) set
// COOKIE_SECURE=false so the browser still returns the cookie.
const isProd = process.env.COOKIE_SECURE !== undefined
  ? process.env.COOKIE_SECURE === "true"
  : process.env.NODE_ENV === "production";

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function setSessionCookie(res, token) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (isProd) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res) {
  const attrs = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isProd) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

// Populates req.user / req.userId from the session cookie when present.
async function attachUser(req, res, next) {
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    const user = await getSessionUser(token);
    if (user) {
      req.user = user;
      req.userId = user.id;
      req.sessionToken = token;
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: "not_authenticated" });
  next();
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth
};
