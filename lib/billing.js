// Stripe: collect and validate a card at registration, save it on file, charge
// nothing. The card is entered into Stripe's own iframe on the client and
// tokenised there - it never reaches this server.
//
//   STRIPE_SECRET_KEY       server key (sk_test_... / sk_live_...)
//   STRIPE_PUBLISHABLE_KEY  client key (pk_test_... / pk_live_...)
//
// If the keys are unset the card step is skipped (dev convenience). In
// production that is a hard error - see requireBillingInProduction().
const Stripe = require("stripe");

const SECRET = process.env.STRIPE_SECRET_KEY || "";
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || "";
const billingConfigured = !!(SECRET && PUBLISHABLE);

let stripe = null;
function client() {
  if (!stripe) stripe = new Stripe(SECRET);
  return stripe;
}

function publishableKey() {
  return PUBLISHABLE;
}

// True when a card is required but Stripe isn't configured. In that state the
// server stays up for existing users but /register is closed - see server.js.
const registrationBlocked = !billingConfigured && process.env.NODE_ENV === "production";

function warnIfBillingMisconfigured() {
  if (registrationBlocked) {
    console.error(
      "[billing] NODE_ENV=production but STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY are unset - " +
      "new registrations are blocked until they are set."
    );
  }
}

// A SetupIntent the client confirms with the card details. No customer yet -
// one is created only once registration actually completes. `payment_method_types`
// is intentionally omitted (methods are governed from the Dashboard);
// `allow_redirects: "never"` keeps this to inline methods so registration never
// bounces the browser off to a redirect-based flow.
async function createSetupIntent() {
  const si = await client().setupIntents.create({
    usage: "off_session",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { purpose: "registration_card_on_file" }
  });
  return { clientSecret: si.client_secret };
}

// Called after the client has confirmed the SetupIntent. Verifies it really
// succeeded, then creates a Customer for the account and puts the card on file.
// Returns the ids to store on the user, or throws "card_not_validated".
async function finalizeCard(setupIntentId, email) {
  const invalid = () => {
    const e = new Error("card_not_validated");
    e.code = "card_not_validated";
    return e;
  };
  if (typeof setupIntentId !== "string" || !/^seti_/.test(setupIntentId)) throw invalid();

  let si;
  try {
    si = await client().setupIntents.retrieve(setupIntentId);
  } catch (err) {
    if (err && err.type === "StripeInvalidRequestError") throw invalid();
    throw err;
  }
  if (si.status !== "succeeded" || !si.payment_method) throw invalid();
  const paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method.id;

  const customer = await client().customers.create({
    email,
    payment_method: paymentMethodId,
    invoice_settings: { default_payment_method: paymentMethodId },
    metadata: { source: "registration" }
  });

  return { customerId: customer.id, paymentMethodId };
}

module.exports = {
  billingConfigured,
  registrationBlocked,
  publishableKey,
  warnIfBillingMisconfigured,
  createSetupIntent,
  finalizeCard
};
