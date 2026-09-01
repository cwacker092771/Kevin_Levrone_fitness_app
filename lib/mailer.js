// Transactional email via Amazon SES.
//
// Configuration (env):
//   MAIL_FROM   verified SES sender, e.g. "The Levrone Protocol <noreply@yourdomain>"
//   SES_REGION  SES region (falls back to AWS_REGION, then us-east-1)
//
// Credentials come from the default AWS provider chain - on EC2 that is the
// instance role (which needs ses:SendEmail). If MAIL_FROM is unset, or the
// send fails, the verification link is logged instead so local dev and
// misconfigured environments still work. Callers should not treat a failed
// send as a failed registration.
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const FROM = process.env.MAIL_FROM || "";
const REGION = process.env.SES_REGION || process.env.AWS_REGION || "us-east-1";

let client = null;
function ses() {
  if (!client) client = new SESClient({ region: REGION });
  return client;
}

async function sendVerificationEmail(to, verifyUrl) {
  if (!FROM) {
    console.log(`[mailer] MAIL_FROM not set - verification link for ${to}:\n  ${verifyUrl}`);
    return { delivered: false, reason: "not_configured" };
  }
  const text =
    `Confirm this email address to activate your Levrone Protocol account:\n\n` +
    `${verifyUrl}\n\nThe link expires in 24 hours. If you didn't sign up, ignore this message.`;
  const html =
    `<p>Confirm this email address to activate your Levrone Protocol account:</p>` +
    `<p><a href="${verifyUrl}">${verifyUrl}</a></p>` +
    `<p>The link expires in 24 hours. If you didn't sign up, ignore this message.</p>`;
  try {
    await ses().send(new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: "Verify your email - The Levrone Protocol" },
        Body: { Text: { Data: text }, Html: { Data: html } }
      }
    }));
    return { delivered: true };
  } catch (err) {
    console.error(`[mailer] SES send to ${to} failed: ${err.message}. Link: ${verifyUrl}`);
    return { delivered: false, reason: "send_failed" };
  }
}

module.exports = { sendVerificationEmail, mailerConfigured: !!FROM };
