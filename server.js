const express = require("express");
const path = require("path");
const fs = require("fs");
const pool = require("./db/pool");
const plans = require("./db/plans");
const metrics = require("./db/metrics");
const notes = require("./db/notes");
const auth = require("./db/auth");
const licenses = require("./db/licenses");
const { LICENSE_TIERS, ADDITIONAL_SERVICES } = require("./lib/licenseTiers");
const { attachUser, requireAuth, setSessionCookie, clearSessionCookie } = require("./lib/session");
const { importMetricsCsv } = require("./lib/importMetricsCsv");
const { BODY_METRIC_FIELDS } = require("./lib/bodyMetricFields");
const { checkPasswordStrength } = require("./lib/passwordPolicy");
const { sendVerificationEmail } = require("./lib/mailer");
const billing = require("./lib/billing");
const { parseAvatarDataUri } = require("./lib/avatar");
const goalImage = require("./lib/goalImage");

const app = express();
const PORT = process.env.PORT || 3000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Usernames are the account's email address. Keep the check permissive but
// require a single "@" with a dotted domain and no spaces.
const USERNAME_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// In production the app runs behind a reverse proxy (Caddy / nginx / ELB) that
// terminates TLS. Trust the first proxy hop so req.ip / req.protocol reflect
// the real client.
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.use(express.json({ limit: "5mb" }));
app.use(attachUser);
app.use(express.static(path.join(__dirname, "public")));

// Unauthenticated liveness/readiness probe for load balancers and monitoring.
// Reports 200 only when the database is reachable.
app.get("/healthz", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "db_unavailable" });
  }
});

function isValidDate(str) {
  return DATE_RE.test(str) && !Number.isNaN(Date.parse(str));
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    hasAvatar: !!user.has_avatar,
    hasGoalImage: !!user.has_goal_image
  };
}

// Public base URL for links in outbound email. Behind the production proxy
// `trust proxy` makes req.protocol/host correct; APP_URL overrides if needed.
function baseUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

async function issueVerification(req, user) {
  const { token } = await auth.createEmailVerification(user.id);
  const link = `${baseUrl(req)}/api/auth/verify?token=${token}`;
  const result = await sendVerificationEmail(user.username, link);
  // In non-production, hand the link back so the flow is testable without SES.
  const devLink = process.env.NODE_ENV !== "production" && !result.delivered ? link : undefined;
  return { delivered: result.delivered, devLink };
}

// Card collection: the client creates a SetupIntent here, confirms it with the
// card in Stripe's own iframe, then sends the setup intent id to /register.
app.get("/api/billing/config", (req, res) => {
  res.json({ enabled: billing.billingConfigured, publishableKey: billing.publishableKey() });
});

app.post("/api/billing/setup-intent", async (req, res) => {
  if (!billing.billingConfigured) return res.json({ enabled: false });
  try {
    res.json({ enabled: true, ...(await billing.createSetupIntent()) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "billing_unavailable" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  if (billing.registrationBlocked) {
    return res.status(503).json({ error: "registration_closed" });
  }
  const { username, password, setupIntentId, avatar } = req.body || {};
  if (typeof username !== "string" || !USERNAME_RE.test(username.trim())) {
    return res.status(400).json({ error: "invalid_username" });
  }
  const pwProblem = checkPasswordStrength(password, username.trim());
  if (pwProblem) {
    return res.status(400).json({ error: "weak_password", message: pwProblem });
  }

  // Optional profile photo. Absent is fine; present-but-bad is rejected.
  let avatarImg = null;
  if (avatar != null && avatar !== "") {
    avatarImg = parseAvatarDataUri(avatar);
    if (!avatarImg) return res.status(400).json({ error: "invalid_avatar" });
  }

  // Reject a taken email before touching Stripe, so we don't create a customer
  // for a registration that can't succeed.
  if (await auth.getUserByUsername(username.trim())) {
    return res.status(409).json({ error: "username_taken" });
  }

  // Validate and store the card before creating the account, so a failed card
  // never leaves an orphaned user behind.
  let card = null;
  if (billing.billingConfigured) {
    try {
      card = await billing.finalizeCard(setupIntentId, username.trim());
    } catch (err) {
      if (err.code === "card_not_validated") {
        return res.status(402).json({ error: "card_not_validated" });
      }
      console.error(err);
      return res.status(502).json({ error: "billing_unavailable" });
    }
  }

  try {
    const user = await auth.createUser(username.trim(), password, {
      stripeCustomerId: card && card.customerId,
      stripePaymentMethodId: card && card.paymentMethodId,
      avatarData: avatarImg && avatarImg.buffer,
      avatarMime: avatarImg && avatarImg.mime
    });
    // No session yet — the account is inert until the email is verified.
    const { delivered, devLink } = await issueVerification(req, user);
    res.status(201).json({ status: "verification_sent", email: user.username, delivered, devLink });
  } catch (err) {
    if (err.code === "username_taken") {
      return res.status(409).json({ error: "username_taken" });
    }
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "missing_credentials" });
  }
  try {
    const user = await auth.verifyUser(username, password);
    if (!user) return res.status(401).json({ error: "invalid_credentials" });
    if (!user.emailVerified) {
      return res.status(403).json({ error: "email_not_verified", email: user.username });
    }
    const { token } = await auth.createSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: publicUser(user), license: await licenses.getLicense(user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// Clicked from the verification email. Marks the address verified, starts a
// session, and drops the user into the app.
app.get("/api/auth/verify", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  try {
    const userId = await auth.consumeEmailVerification(token);
    if (!userId) {
      return res
        .status(400)
        .type("html")
        .send(verifyResultPage("This verification link is invalid or has expired.",
          "Request a new one from the login screen."));
    }
    const { token: sessionToken } = await auth.createSession(userId);
    setSessionCookie(res, sessionToken);
    res.redirect("/?verified=1");
  } catch (err) {
    console.error(err);
    res.status(500).type("html").send(verifyResultPage("Something went wrong verifying your email.",
      "Try the link again in a moment."));
  }
});

app.post("/api/auth/resend-verification", async (req, res) => {
  const { username } = req.body || {};
  if (typeof username !== "string") return res.status(400).json({ error: "missing_credentials" });
  try {
    const user = await auth.getUserByUsername(username.trim());
    let devLink;
    if (user && !user.emailVerified) {
      ({ devLink } = await issueVerification(req, user));
    }
    // Always 200 — don't disclose whether the account exists or is already verified.
    res.json({ status: "sent", devLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

function verifyResultPage(heading, sub) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email verification</title>
<body style="font-family:system-ui,sans-serif;background:#131211;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="max-width:26rem;padding:2rem;text-align:center">
<h1 style="color:#d4a72c;font-size:1.3rem">${heading}</h1>
<p style="color:#aaa">${sub}</p>
<p><a href="/" style="color:#d4a72c">Back to sign in</a></p>
</div>`;
}

app.post("/api/auth/logout", async (req, res) => {
  try {
    await auth.deleteSession(req.sessionToken);
  } catch (err) {
    console.error(err);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "not_authenticated" });
  try {
    res.json({ user: publicUser(req.user), license: await licenses.getLicense(req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------------
// Licensing
// ---------------------------------------------------------------------------
// Public: the tiers and add-on services shown in the registration-time picker.
app.get("/api/license/tiers", (req, res) => {
  res.json({ tiers: LICENSE_TIERS, services: ADDITIONAL_SERVICES });
});

// Everything below this line requires a valid session.
app.use("/api", requireAuth);

// The signed-in user's avatar photo (uploaded at registration), served through
// the same canonical square crop the goal-image generator starts from, so the
// "Day One" and "Your Goal" header photos line up as a before / after pair.
app.get("/api/avatar", async (req, res) => {
  try {
    const avatar = await auth.getAvatar(req.userId);
    if (!avatar) return res.status(404).end();
    let body = avatar.data;
    let type = avatar.mime;
    try {
      body = await goalImage.normalizeBase(avatar.data);
      type = "image/jpeg";
    } catch (e) {
      console.error("avatar normalize failed, serving raw:", e.message);
    }
    res.set("Content-Type", type);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// The AI-generated "goal physique" portrait.
app.get("/api/goal-image", async (req, res) => {
  try {
    const img = await auth.getGoalImage(req.userId);
    if (!img) return res.status(404).end();
    res.set("Content-Type", img.mime);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(img.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});


// Any signed-in user can read or install their license. This sits above the
// requireLicense gate so an unlicensed account can still pick a tier.
app.get("/api/license", async (req, res) => {
  try {
    res.json({ license: await licenses.getLicense(req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/license", async (req, res) => {
  const { tier, addon } = req.body || {};
  try {
    const existing = await licenses.getLicense(req.userId);
    if (existing && existing.status === "canceled") {
      return res.status(403).json({ error: "service_canceled" });
    }
    const license = await licenses.setLicense(req.userId, tier, addon);
    res.json({ license });
  } catch (err) {
    if (err.code === "invalid_tier" || err.code === "invalid_addon") {
      return res.status(400).json({ error: err.code });
    }
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// Everything below this line also requires an installed license (active OR
// canceled - a canceled account can still read its data).
async function requireLicense(req, res, next) {
  try {
    const license = await licenses.getLicense(req.userId);
    if (!license) return res.status(402).json({ error: "license_required" });
    req.license = license;
    next();
  } catch (err) {
    next(err);
  }
}
app.use("/api", requireLicense);

// Self-service cancellation. The user must type "cancel" in the GUI; the client
// sends it as `confirm`. Data is left intact - only the license flag flips and
// any Stripe subscriptions are canceled so no further payments are taken.
app.post("/api/license/cancel", async (req, res) => {
  const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim().toLowerCase() : "";
  if (confirm !== "cancel") {
    return res.status(400).json({ error: "confirmation_required" });
  }
  try {
    const license = await licenses.cancelLicense(req.userId);
    if (!license) return res.status(409).json({ error: "already_canceled" });

    let subscriptionsCanceled = 0;
    try {
      const customerId = await auth.getStripeCustomerId(req.userId);
      ({ canceled: subscriptionsCanceled } = await billing.cancelSubscriptions(customerId));
    } catch (err) {
      // Don't leave the account half-canceled if Stripe hiccups - the flag is
      // already set. Surface it in logs for manual follow-up.
      console.error("subscription cancellation failed for user", req.userId, err.message);
    }
    res.json({ license, subscriptionsCanceled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// Once canceled, the account is read-only: reject every mutating request but
// keep GETs working so the user can still view their history.
app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && req.license && req.license.status === "canceled") {
    return res.status(403).json({ error: "service_canceled" });
  }
  next();
});

// Kicked off by the client right after the goal form is saved. Regenerates the
// "goal physique" portrait only when the goal signature changed. Slow (Bedrock),
// so the client shows a placeholder while it runs.
app.post("/api/goal-image", async (req, res) => {
  if (!goalImage.enabled) return res.json({ status: "disabled" });
  const goal = req.body || {};
  const signature = goalImage.goalSignature(goal);
  try {
    const state = await auth.getGoalImageState(req.userId);
    if (state.hasImage && state.signature === signature) {
      return res.json({ status: "current" });
    }
    const avatar = await auth.getAvatar(req.userId);
    if (!avatar) return res.json({ status: "no_photo" });

    const image = await goalImage.generateGoalImage(goal, avatar.data);
    await auth.setGoalImage(req.userId, { data: image, mime: "image/jpeg", signature });
    res.json({ status: "generated" });
  } catch (err) {
    console.error("goal image generation failed:", err.message);
    res.status(502).json({ error: "goal_image_failed" });
  }
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
app.get("/api/plans/dates", async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: "invalid_year_or_month" });
  }
  try {
    const dates = await plans.getPlanDatesInMonth(req.userId, year, month);
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
    const plan = await plans.getPlan(req.userId, date);
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
    const plan = await plans.upsertPlan(req.userId, date, inputs, stats, groups);
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
    const plan = await plans.setItemChecked(req.userId, date, itemId, req.body.checked);
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
    const plan = await plans.resetChecked(req.userId, date);
    if (!plan) return res.status(404).json({ error: "not_found" });
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------------
// Body metrics
// ---------------------------------------------------------------------------
app.get("/api/metrics", async (req, res) => {
  try {
    const list = await metrics.listMetrics(req.userId);
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
    const metric = await metrics.getMetric(req.userId, date);
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
      await metrics.upsertMetric(req.userId, entry.date, entry);
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
    const metric = await metrics.upsertMetric(req.userId, date, data);
    res.json(metric);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
app.get("/api/notes/dates", async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: "invalid_year_or_month" });
  }
  try {
    const dates = await notes.getNoteDatesInMonth(req.userId, year, month);
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
    const note = await notes.getNote(req.userId, date);
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
    const note = await notes.upsertNote(req.userId, date, req.body.note);
    res.json(note);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// Local-dev HTTPS: when HTTPS_PORT is set, serve TLS on it with the cert pair
// in ./certs (run `npm run gen-cert` once) and turn the plain-HTTP port into a
// permanent redirect to it. In production TLS is the reverse proxy's job, so
// this stays off.
function listen() {
  const httpsPort = process.env.HTTPS_PORT;
  const certDir = path.join(__dirname, "certs");
  const keyPath = path.join(certDir, "localhost-key.pem");
  const certPath = path.join(certDir, "localhost.pem");

  if (httpsPort && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const https = require("https");
    const http = require("http");
    https
      .createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
      .listen(httpsPort, () => console.log(`Levrone Protocol (HTTPS) at https://localhost:${httpsPort}`));
    http
      .createServer((req, res) => {
        // 302, not 301 - a dev toggle shouldn't get cached permanently by the browser.
        res.writeHead(302, { Location: `https://localhost:${httpsPort}${req.url}` });
        res.end();
      })
      .listen(PORT, () => console.log(`http://localhost:${PORT} -> redirects to https://localhost:${httpsPort}`));
    return;
  }

  if (httpsPort) {
    console.warn(`HTTPS_PORT set but ./certs is missing - run 'npm run gen-cert'. Serving plain HTTP.`);
  }
  app.listen(PORT, () => {
    console.log(`Levrone Protocol server running at http://localhost:${PORT}`);
  });
}

async function start() {
  const schemaSql = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(schemaSql);
  billing.warnIfBillingMisconfigured();
  await auth.deleteExpiredSessions().catch((err) => console.error("session cleanup failed:", err));
  await auth.deleteExpiredEmailVerifications().catch((err) => console.error("verification cleanup failed:", err));
  listen();
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
