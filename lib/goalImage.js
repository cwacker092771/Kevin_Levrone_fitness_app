// Generates a "target physique" portrait of the user with Amazon Bedrock. Their
// uploaded avatar is run through Stable Diffusion 3.5 in image-to-image mode at
// a low strength, so their face and features are kept while the body and scene
// are pushed toward their fitness goal. Output is downscaled before storage.
//
//   GOAL_IMAGE=true          turn the feature on (off by default; it costs money
//                            and needs Bedrock model access enabled)
//   BEDROCK_REGION           region for the model (default us-west-2)
//   BEDROCK_IMAGE_MODEL      model id (default stability.sd3-5-large-v1:0)
//   GOAL_IMAGE_STRENGTH      img2img strength 0..1 (default 0.42) - lower keeps
//                            more of the original photo / face
//
// Credentials come from the default AWS chain - on EC2 that's the instance role,
// which needs bedrock:InvokeModel.
const crypto = require("crypto");
const sharp = require("sharp");

const enabled = process.env.GOAL_IMAGE === "true";
const REGION = process.env.BEDROCK_REGION || "us-west-2";
const MODEL_ID = process.env.BEDROCK_IMAGE_MODEL || "stability.sd3-5-large-v1:0";
// 0.55 is the sweet spot: the face stays recognisable while the build changes.
// Higher and it drifts into a different person; lower and nothing changes.
const STRENGTH = clamp01(parseFloat(process.env.GOAL_IMAGE_STRENGTH), 0.55);
const OUT_SIZE = 768;   // header shows a small thumb; hover enlarges to this

function clamp01(n, fallback) {
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

let client = null;
function bedrock() {
  if (!client) {
    const { BedrockRuntimeClient } = require("@aws-sdk/client-bedrock-runtime");
    client = new BedrockRuntimeClient({ region: REGION });
  }
  return client;
}

const GOAL_PHRASE = {
  cut: "a lean, sharply defined, low-body-fat physique",
  bulk: "a powerful, muscular, well-built physique",
  recomp: "a lean and athletic recomposed physique with visible muscle",
  maintain: "a fit, toned, healthy physique"
};

// A hash of the goal inputs that actually affect the image - the picture only
// regenerates when one of these changes.
function goalSignature(goal) {
  const key = JSON.stringify({
    sex: goal.sex || null,
    goal: goal.goal || null,
    experience: goal.experience || null,
    days: goal.days != null ? String(goal.days) : null
  });
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function buildPrompt(goal) {
  const physique = GOAL_PHRASE[goal.goal] || GOAL_PHRASE.maintain;
  return (
    `Portrait of the same person with the exact same face, hair and identity, ` +
    `transformed to have ${physique}, wearing athletic gym clothing, confident ` +
    `posture, warm flattering light, sharp focus, photorealistic, high detail`
  );
}

// Returns a JPEG Buffer (OUT_SIZE square), or throws. `avatarBuffer` is the
// reference photo.
async function generateGoalImage(goal, avatarBuffer) {
  const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
  // SD3.5 img2img wants a PNG/JPEG whose dimensions are supported; a clean
  // square from the avatar is safe.
  const seedImg = await sharp(avatarBuffer)
    .resize(768, 768, { fit: "cover" })
    .jpeg({ quality: 90 })
    .toBuffer();

  const body = {
    prompt: buildPrompt(goal),
    negative_prompt: "different person, distorted face, deformed anatomy, extra limbs, text, watermark, blurry",
    mode: "image-to-image",
    image: seedImg.toString("base64"),
    strength: STRENGTH,
    output_format: "png",
    seed: crypto.randomInt(0, 2 ** 31)
  };
  const res = await bedrock().send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body)
  }));
  const parsed = JSON.parse(Buffer.from(res.body).toString("utf8"));
  const b64 = parsed.images && parsed.images[0];
  if (!b64) throw new Error("Bedrock returned no image");
  if (parsed.finish_reasons && parsed.finish_reasons[0]) {
    throw new Error(`image not usable: ${parsed.finish_reasons[0]}`);
  }
  return sharp(Buffer.from(b64, "base64"))
    .resize(OUT_SIZE, OUT_SIZE, { fit: "cover" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

module.exports = { enabled, goalSignature, generateGoalImage };
