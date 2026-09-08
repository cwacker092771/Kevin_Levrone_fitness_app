// Builds the "Your Goal" header portrait. No external services - it's a local
// photographic treatment of the user's own Day One photo, so it always looks
// exactly like them. A warm cinematic colour grade, a gentle contrast/clarity
// lift and a soft vignette, tuned a little by the fitness goal.
//
//   GOAL_IMAGE=true   turn the feature on (off by default)
//
// The earlier AWS Bedrock / Rekognition generation was removed - it idealised
// the face and didn't reliably look like the user.
const crypto = require("crypto");
const sharp = require("sharp");

const enabled = process.env.GOAL_IMAGE === "true";

const WORK_SIZE = 1024;  // canonical crop shared with the Day One photo
const OUT_SIZE = 768;    // header shows a small thumb; hover enlarges to this

// The canonical square crop of the user's photo. Both the "Day One" header
// image and this treatment start from exactly this, so the before / after pair
// lines up. Centre cover-crop, matching the CSS object-fit boxes.
async function normalizeBase(avatarBuffer) {
  return sharp(avatarBuffer)
    .rotate()  // honour EXIF orientation
    .resize(WORK_SIZE, WORK_SIZE, { fit: "cover", position: "centre" })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// Bumped whenever the treatment changes in a way that should remake every
// previously stored image.
const PIPELINE_VERSION = "4-local-grade";

// A hash of the goal inputs that affect the image - the picture only
// regenerates when one of these (or the pipeline version) changes.
function goalSignature(goal) {
  const key = JSON.stringify({
    v: PIPELINE_VERSION,
    sex: goal.sex || null,
    goal: goal.goal || null,
    experience: goal.experience || null,
    days: goal.days != null ? String(goal.days) : null
  });
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// Per-goal grade. `warm` is the opacity of a warm soft-light wash; `contrast`
// is a linear slope about mid-grey; `sat`/`bright` feed sharp.modulate.
const GRADE = {
  cut:      { bright: 1.03, sat: 1.06, contrast: 1.13, warm: 0.10, cool: 0.05 },
  bulk:     { bright: 1.02, sat: 1.13, contrast: 1.09, warm: 0.16, cool: 0.0 },
  recomp:   { bright: 1.02, sat: 1.09, contrast: 1.08, warm: 0.13, cool: 0.02 },
  maintain: { bright: 1.02, sat: 1.05, contrast: 1.05, warm: 0.11, cool: 0.02 }
};

function washSvg(size, rgb, opacity) {
  return Buffer.from(
    `<svg width="${size}" height="${size}">` +
    `<rect width="100%" height="100%" fill="rgb(${rgb})" fill-opacity="${opacity}"/>` +
    `</svg>`
  );
}

function vignetteSvg(size) {
  return Buffer.from(
    `<svg width="${size}" height="${size}">` +
    `<defs><radialGradient id="v" cx="50%" cy="43%" r="72%">` +
    `<stop offset="52%" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity="0.4"/>` +
    `</radialGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#v)"/></svg>`
  );
}

// Returns a JPEG Buffer (OUT_SIZE square). `avatarBuffer` is the reference photo.
async function generateGoalImage(goal, avatarBuffer) {
  const g = GRADE[goal.goal] || GRADE.maintain;
  const base = await normalizeBase(avatarBuffer);

  const graded = await sharp(base)
    .modulate({ brightness: g.bright, saturation: g.sat })
    .linear(g.contrast, -(128 * (g.contrast - 1)))
    .gamma(1.02)
    .sharpen({ sigma: 1.1, m1: 0.6, m2: 2.2 })
    .resize(OUT_SIZE, OUT_SIZE, { fit: "cover" })
    .toBuffer();

  const layers = [];
  if (g.warm > 0) {
    layers.push({ input: washSvg(OUT_SIZE, "255,176,92", g.warm), blend: "soft-light" });
  }
  if (g.cool > 0) {
    layers.push({ input: washSvg(OUT_SIZE, "90,150,255", g.cool), blend: "soft-light" });
  }
  layers.push({ input: vignetteSvg(OUT_SIZE), blend: "over" });

  return sharp(graded)
    .composite(layers)
    .jpeg({ quality: 88 })
    .toBuffer();
}

module.exports = { enabled, goalSignature, generateGoalImage, normalizeBase };
