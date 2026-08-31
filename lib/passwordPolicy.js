// Password strength policy, shared by the register endpoint (enforced) and the
// client (shown as a hint). A password must be long, mix character classes,
// avoid obvious sequences, and not echo the account's email.
const MIN_PASSWORD_LEN = 12;
const MAX_PASSWORD_LEN = 200;

// A short list of the passwords attackers try first. Comparison is
// case-insensitive and ignores a trailing run of digits ("password123").
const COMMON_PASSWORDS = [
  "password", "passw0rd", "letmein", "welcome", "admin", "iloveyou",
  "qwerty", "qwertyuiop", "asdfghjkl", "zxcvbnm", "monkey", "dragon",
  "football", "baseball", "superman", "batman", "trustno1", "sunshine",
  "princess", "master", "shadow", "michael", "levrone", "protocol",
  "changeme", "secret", "abc123", "123456", "12345678", "123456789"
];

const KEYBOARD_SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "01234567890",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm"
];

function hasRun(pw, len) {
  let run = 1;
  for (let i = 1; i < pw.length; i++) {
    run = pw[i] === pw[i - 1] ? run + 1 : 1;
    if (run >= len) return true;
  }
  return false;
}

function hasSequence(pw, len) {
  const lower = pw.toLowerCase();
  for (const seq of KEYBOARD_SEQUENCES) {
    const rev = seq.split("").reverse().join("");
    for (let i = 0; i + len <= seq.length; i++) {
      if (lower.includes(seq.slice(i, i + len))) return true;
    }
    for (let i = 0; i + len <= rev.length; i++) {
      if (lower.includes(rev.slice(i, i + len))) return true;
    }
  }
  return false;
}

// Returns a human-readable reason the password is too weak, or null if it
// satisfies the policy. `username` is the account email, used to reject
// passwords built from it.
function checkPasswordStrength(password, username) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
    return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
  }
  if (password.length > MAX_PASSWORD_LEN) {
    return `Password must be at most ${MAX_PASSWORD_LEN} characters.`;
  }

  const classes =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
  if (classes < 3) {
    return "Password must mix upper- and lower-case letters, digits and symbols.";
  }

  if (hasRun(password, 3)) {
    return "Password can't repeat the same character 3+ times in a row.";
  }
  if (hasSequence(password, 4)) {
    return "Password can't contain a run of sequential or keyboard-adjacent characters.";
  }

  const stripped = password.toLowerCase().replace(/[0-9]+$/, "");
  if (COMMON_PASSWORDS.includes(stripped)) {
    return "That password is too common — pick something less predictable.";
  }
  for (const common of COMMON_PASSWORDS) {
    if (common.length >= 5 && password.toLowerCase().includes(common)) {
      return "Password contains a common word — pick something less predictable.";
    }
  }

  const local = String(username || "").split("@")[0].toLowerCase();
  if (local.length >= 3 && password.toLowerCase().includes(local)) {
    return "Password can't contain your email address.";
  }

  if (new Set(password).size < 6) {
    return "Password doesn't use enough distinct characters.";
  }

  return null;
}

const POLICY_HINT =
  `At least ${MIN_PASSWORD_LEN} characters, mixing upper- and lower-case letters, ` +
  `digits and symbols. No common words, sequences, or your email.`;

module.exports = {
  MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN,
  POLICY_HINT,
  checkPasswordStrength
};
