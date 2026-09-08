// Parses an avatar `data:` URI sent from the client. The client resizes the
// photo to a small square before upload; this just guards against oversized or
// non-image payloads.
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 512 * 1024;

// Returns { mime, buffer } for a valid image data URI, or null otherwise.
function parseAvatarDataUri(value) {
  if (typeof value !== "string") return null;
  const m = value.match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!ALLOWED.has(mime)) return null;
  let buffer;
  try {
    buffer = Buffer.from(m[2], "base64");
  } catch (e) {
    return null;
  }
  if (buffer.length === 0 || buffer.length > MAX_BYTES) return null;
  return { mime, buffer };
}

module.exports = { parseAvatarDataUri, MAX_BYTES, ALLOWED };
