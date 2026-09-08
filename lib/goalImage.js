// Generates a "target physique" portrait of the user with Amazon Bedrock.
//
// Primary path - FACE-LOCK INPAINTING: the uploaded avatar is run through AWS
// Rekognition to locate the face, an elliptical mask is built over it, and
// Stable Image Inpaint repaints only what's outside the mask (body, clothing,
// background) toward the fitness goal. The user's real face pixels are left
// untouched, so it stays unmistakably them.
//
// Fallback path - SD3.5 IMAGE-TO-IMAGE: if no face is detected, or Rekognition
// / the inpaint model errors, we fall back to a low-strength img2img pass that
// keeps most of the original photo.
//
//   GOAL_IMAGE=true          turn the feature on (off by default; it costs money
//                            and needs Bedrock model access enabled)
//   BEDROCK_REGION           region for the image models (default us-west-2)
//   BEDROCK_INPAINT_MODEL    inpaint model / inference profile id
//                            (default us.stability.stable-image-inpaint-v1:0)
//   BEDROCK_IMAGE_MODEL      fallback img2img model (default stability.sd3-5-large-v1:0)
//   REKOGNITION_REGION       region for face detection (default us-east-1)
//   GOAL_IMAGE_STRENGTH      fallback img2img strength 0..1 (default 0.38)
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
const STRENGTH = clamp01(parseFloat(process.env.GOAL_IMAGE_STRENGTH), 0.38);

const WORK_SIZE = 1024;  // square the models operate on
const OUT_SIZE = 768;    // header shows a small thumb; hover enlarges to this

function clamp01(n, fallback) {
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
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

const GOAL_PHRASE = {
  cut: "a lean, sharply defined, low-body-fat physique with visible abs",
  bulk: "a powerful, muscular, well-built bodybuilder physique",
  recomp: "a lean and athletic recomposed physique with visible muscle definition",
  maintain: "a fit, toned, healthy athletic physique"
};

// Bumped whenever the generation pipeline changes in a way that should
// invalidate every previously stored image (new model, new prompt, new mask).
const PIPELINE_VERSION = "2-facelock";

// A hash of the goal inputs that actually affect the image - the picture only
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
  const build = goal.sex === "female" ? "toned athletic" : "muscular";
  return (
    `The same person a few months into serious training, now with ${physique}. ` +
    `${build} shoulders, chest and arms, athletic fitted gym clothing, ` +
    `same background and lighting, photorealistic photo, natural light, sharp focus.`
  );
}

const NEGATIVE = "different person, different face, face swap, distorted face, deformed anatomy, extra limbs, text, watermark, blurry, cartoon";

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

// Build a mask the size of the work image: white = repaint, black = preserve.
// The preserved region is a feathered ellipse over the face, expanded to take
// in the hair and jaw but kept clear of the shoulders so the body can change.
async function buildMask(bbox, size) {
  const padX = 0.32;   // widen for ears / hair sides
  const padUp = 0.55;  // extra height above for hair
  const padDown = 0.30; // a little below the chin, stopping short of shoulders

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
    .blur(Math.max(6, size * 0.025))  // feather the edge
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
      `The exact same person, same face, same hair, same skin tone - ` +
      `unmistakably them - a few months from now after training, having ` +
      `reached ${physique}. Same head and pose, athletic fitted clothing, ` +
      `warm flattering light, photorealistic portrait, sharp focus, natural.`,
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
  const baseJpeg = await sharp(avatarBuffer)
    .resize(WORK_SIZE, WORK_SIZE, { fit: "cover" })
    .jpeg({ quality: 92 })
    .toBuffer();

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

module.exports = { enabled, goalSignature, generateGoalImage };
