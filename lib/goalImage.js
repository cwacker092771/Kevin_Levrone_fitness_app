// Generates a "Target You" portrait with Amazon Bedrock.
//
// FACE-LOCK INPAINTING: the uploaded avatar is run through AWS Rekognition to
// locate the face; a tight feathered mask is drawn over the face + hair only,
// and Stable Image Inpaint repaints everything else (neck, torso, clothing,
// background) into a dramatically fitter physique. The real face pixels are
// left untouched, so it still looks unmistakably like the user - but the body
// change is meant to be obvious.
//
// FALLBACK - SD3.5 IMAGE-TO-IMAGE: if no face is detected, or Rekognition / the
// inpaint model errors, fall back to an img2img pass.
//
//   GOAL_IMAGE=true          turn the feature on (off by default; costs money
//                            and needs Bedrock model access enabled)
//   BEDROCK_REGION           region for the image models (default us-west-2)
//   BEDROCK_INPAINT_MODEL    inpaint model / inference profile id
//                            (default us.stability.stable-image-inpaint-v1:0)
//   BEDROCK_IMAGE_MODEL      fallback img2img model (default stability.sd3-5-large-v1:0)
//   REKOGNITION_REGION       region for face detection (default us-east-1)
//   GOAL_IMAGE_STRENGTH      fallback img2img strength 0..1 (default 0.55)
//
// Credentials come from the default AWS chain - on EC2 that's the instance role,
// which needs bedrock:InvokeModel and rekognition:DetectFaces.
const crypto = require("crypto");
const sharp = require("sharp");

const enabled = process.env.GOAL_IMAGE === "true";
const REGION = process.env.BEDROCK_REGION || "us-west-2";
const INPAINT_MODEL = process.env.BEDROCK_INPAINT_MODEL || "us.stability.stable-image-inpaint-v1:0";
const IMG2IMG_MODEL = process.env.BEDROCK_IMAGE_MODEL || "stability.sd3-5-large-v1:0";
const REKOGNITION_REGION = process.env.REKOGNITION_REGION || "us-east-1";
const STRENGTH = clamp01(parseFloat(process.env.GOAL_IMAGE_STRENGTH), 0.55);

const WORK_SIZE = 1024;  // square the models operate on
const OUT_SIZE = 768;    // header shows a small thumb; hover enlarges to this

function clamp01(n, fallback) {
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

// The canonical square crop of the user's photo. Both the "Day One" header
// image and the goal-image generator start from exactly this, so the before /
// after pair lines up. Centre cover-crop, matching the CSS object-fit boxes.
async function normalizeBase(avatarBuffer) {
  return sharp(avatarBuffer)
    .rotate()  // honour EXIF orientation
    .resize(WORK_SIZE, WORK_SIZE, { fit: "cover", position: "centre" })
    .jpeg({ quality: 90 })
    .toBuffer();
}

let bedrockClient = null;
function bedrock() {
  if (!bedrockClient) {
    const { BedrockRuntimeClient } = require("@aws-sdk/client-bedrock-runtime");
    bedrockClient = new BedrockRuntimeClient({ region: REGION });
  }
  return bedrockClient;
}

let rekClient = null;
function rekognition() {
  if (!rekClient) {
    const { RekognitionClient } = require("@aws-sdk/client-rekognition");
    rekClient = new RekognitionClient({ region: REKOGNITION_REGION });
  }
  return rekClient;
}

// The physique to repaint the body into - written to force an obvious change.
const GOAL_PHRASE = {
  cut:
    "shredded and extremely lean, very low body fat, deep six-pack abs, " +
    "vascular arms, dry hard muscle, competition-lean bodybuilder condition",
  bulk:
    "dramatically more muscular, huge broad shoulders, thick powerful chest, " +
    "big well-developed arms, heavy bodybuilder muscle mass, wide V-taper back",
  recomp:
    "noticeably leaner and much more muscular, visible six-pack abs, defined " +
    "shoulders and arms, tight athletic build with low body fat",
  maintain:
    "fit and athletic with clearly toned muscle, defined shoulders and arms, " +
    "lean healthy build"
};

// Bumped whenever the pipeline changes in a way that should invalidate every
// previously stored image.
const PIPELINE_VERSION = "5-facelock-strong";

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

function bodyPrompt(goal) {
  const physique = GOAL_PHRASE[goal.goal] || GOAL_PHRASE.maintain;
  const who = goal.sex === "female" ? "woman" : "man";
  return (
    `Body transformation "after" photo. The same ${who}, one year into serious ` +
    `training, now with a ${physique}. Wearing a fitted gym tank top or ` +
    `athletic t-shirt that shows the muscle. Bright modern gym in the ` +
    `background. Photorealistic, natural light, sharp focus, full detail.`
  );
}

const NEGATIVE =
  "different person, different face, face swap, distorted face, deformed " +
  "anatomy, extra limbs, skinny, frail, unchanged body, baggy clothing, " +
  "text, watermark, blurry, cartoon, illustration";

// --- face-lock inpainting -------------------------------------------------

// Ask Rekognition where the face is. Returns a normalised BoundingBox
// { Left, Top, Width, Height } (0..1), or null if no confident face.
async function detectFace(jpegBuffer) {
  const { DetectFacesCommand } = require("@aws-sdk/client-rekognition");
  const res = await rekognition().send(new DetectFacesCommand({
    Image: { Bytes: jpegBuffer }
  }));
  const face = (res.FaceDetails || [])
    .filter((f) => f.Confidence >= 90 && f.BoundingBox)
    .sort((a, b) => bboxArea(b.BoundingBox) - bboxArea(a.BoundingBox))[0];
  return face ? face.BoundingBox : null;
}

function bboxArea(b) {
  return b.Width * b.Height;
}

// Mask: white = repaint, black = preserve. Preserve a tight feathered ellipse
// over the face and hair ONLY - the jaw line downward is left repaintable so
// the model can rebuild the neck and whole torso into the new physique.
async function buildMask(bbox, size) {
  const padX = 0.16;    // just past the cheeks / ears
  const padUp = 0.42;   // up over the hair
  const padDown = 0.06; // stop at the chin

  const left = Math.max(0, bbox.Left - bbox.Width * padX) * size;
  const top = Math.max(0, bbox.Top - bbox.Height * padUp) * size;
  const right = Math.min(1, bbox.Left + bbox.Width * (1 + padX)) * size;
  const bottom = Math.min(1, bbox.Top + bbox.Height * (1 + padDown)) * size;

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;

  const svg =
    `<svg width="${size}" height="${size}">` +
    `<rect width="100%" height="100%" fill="white"/>` +
    `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" ` +
    `rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="black"/>` +
    `</svg>`;

  return sharp(Buffer.from(svg))
    .blur(Math.max(5, size * 0.018))  // feather the edge
    .png()
    .toBuffer();
}

function readImage(parsed) {
  const b64 = parsed.images && parsed.images[0];
  if (!b64) throw new Error("Bedrock returned no image");
  const reason = parsed.finish_reasons && parsed.finish_reasons[0];
  if (reason) throw new Error(`image not usable: ${reason}`);
  return Buffer.from(b64, "base64");
}

async function invoke(modelId, body) {
  const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
  const res = await bedrock().send(new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body)
  }));
  return JSON.parse(Buffer.from(res.body).toString("utf8"));
}

async function inpaintGoalImage(goal, baseJpeg) {
  const bbox = await detectFace(baseJpeg);
  if (!bbox) return null;  // signal: fall back to img2img

  const mask = await buildMask(bbox, WORK_SIZE);
  const parsed = await invoke(INPAINT_MODEL, {
    prompt: bodyPrompt(goal),
    negative_prompt: NEGATIVE,
    image: baseJpeg.toString("base64"),
    mask: mask.toString("base64"),
    style_preset: "photographic",
    output_format: "png",
    seed: crypto.randomInt(0, 2 ** 31)
  });
  return readImage(parsed);
}

// --- img2img fallback ---------------------------------------------------

async function img2imgGoalImage(goal, baseJpeg) {
  const physique = GOAL_PHRASE[goal.goal] || GOAL_PHRASE.maintain;
  const parsed = await invoke(IMG2IMG_MODEL, {
    prompt:
      `Body transformation "after" photo of the exact same person - same face, ` +
      `same hair - one year into training, now with a ${physique}. Fitted gym ` +
      `clothing, gym background, photorealistic, sharp focus.`,
    negative_prompt: NEGATIVE,
    mode: "image-to-image",
    image: baseJpeg.toString("base64"),
    strength: STRENGTH,
    output_format: "png",
    seed: crypto.randomInt(0, 2 ** 31)
  });
  return readImage(parsed);
}

// Returns a JPEG Buffer (OUT_SIZE square), or throws. `avatarBuffer` is the
// reference photo.
async function generateGoalImage(goal, avatarBuffer) {
  const baseJpeg = await normalizeBase(avatarBuffer);

  let raw = null;
  try {
    raw = await inpaintGoalImage(goal, baseJpeg);
  } catch (err) {
    console.error("goal image: inpaint path failed, falling back:", err.message);
  }
  if (!raw) {
    raw = await img2imgGoalImage(goal, baseJpeg);
  }

  return sharp(raw)
    .resize(OUT_SIZE, OUT_SIZE, { fit: "cover" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

module.exports = { enabled, goalSignature, generateGoalImage, normalizeBase };
