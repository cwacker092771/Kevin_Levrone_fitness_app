// Generates a stylised "goal physique" portrait with Amazon Bedrock. The user's
// uploaded avatar is used as a structure/control image and their fitness goal
// becomes the prompt, so the result keeps their framing and pose but is a
// painted bodybuilding-poster illustration - not a photoreal edit of a real
// person.
//
//   GOAL_IMAGE=true          turn the feature on (off by default; it costs money
//                            and needs Bedrock model access enabled)
//   BEDROCK_REGION           region for the model (default us-east-1)
//   BEDROCK_IMAGE_MODEL      model / inference-profile id
//                            (default us.stability.stable-image-control-structure-v1:0)
//
// Credentials come from the default AWS chain - on EC2 that's the instance role,
// which needs bedrock:InvokeModel.
const crypto = require("crypto");

const enabled = process.env.GOAL_IMAGE === "true";
const REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL_ID = process.env.BEDROCK_IMAGE_MODEL || "us.stability.stable-image-control-structure-v1:0";

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
  maintain: "a fit, balanced, healthy physique"
};
const EXPERIENCE_PHRASE = {
  beginner: "early in their training journey",
  intermediate: "a seasoned lifter",
  advanced: "a highly experienced, competition-level athlete"
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
  const subject = goal.sex === "female" ? "woman" : goal.sex === "male" ? "man" : "athlete";
  const physique = GOAL_PHRASE[goal.goal] || GOAL_PHRASE.maintain;
  const level = EXPERIENCE_PHRASE[goal.experience] || "";
  return (
    `Heroic motivational poster illustration of a ${subject} with ${physique}` +
    (level ? `, ${level}` : "") +
    `, posing confidently in an old-school iron gym, dramatic warm gold and ` +
    `deep crimson rim lighting, painterly digital art, bold and inspiring, high detail`
  );
}

// Returns a PNG Buffer, or throws. `avatarBuffer` is the reference photo used as
// the structure/control image.
async function generateGoalImage(goal, avatarBuffer) {
  const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
  const body = {
    prompt: buildPrompt(goal),
    negative_prompt: "photograph, text, watermark, logo, deformed anatomy, extra limbs, blurry, low quality",
    image: avatarBuffer.toString("base64"),
    control_strength: 0.55,
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
    // e.g. "CONTENT_FILTERED" - the model returns a blank image in that case.
    throw new Error(`image not usable: ${parsed.finish_reasons[0]}`);
  }
  return Buffer.from(b64, "base64");
}

module.exports = { enabled, goalSignature, generateGoalImage };
