import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const MODEL = "gpt-5.6-luna";

const MAX_IMAGES = 5;

// 单次请求图片 Base64 总大小限制
// Vercel Function 本身还有请求体限制，因此这里提前保护。
const MAX_TOTAL_IMAGE_SIZE = 3.5 * 1024 * 1024;

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function isValidImageDataUrl(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(value)
  );
}

function clampNumber(value, min = 0, max = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, number));
}

function cleanString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

/*
|--------------------------------------------------------------------------
| Extract JSON
|--------------------------------------------------------------------------
*/

function extractJson(text) {

  if (!text) {
    return null;
  }

  /*
   * 第一种：
   * 模型直接返回 JSON
   */

  try {
    return JSON.parse(text);
  } catch {}

  /*
   * 第二种：
   * ```json
   * {...}
   * ```
   */

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  /*
   * 第三种：
   * 从第一个 { 到最后一个 }
   */

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {

    const possibleJson =
      cleaned.slice(start, end + 1);

    try {
      return JSON.parse(possibleJson);
    } catch {}
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| Normalize Snips
|--------------------------------------------------------------------------
*/

function normalizeSnips(snips) {

  if (!Array.isArray(snips)) {
    return [];
  }

  return snips
    .slice(0, 5)
    .map((snip, index) => {

      return {

        id:
          `snip-${index + 1}`,

        rank:
          index + 1,

        label:
          cleanString(snip?.label) ||
          `Snip ${index + 1}`,

        reason:
          cleanString(snip?.reason),

        importance:
          clampNumber(
            snip?.importance,
            0,
            1
          )

      };

    })
    .sort(
      (a, b) =>
        b.importance -
        a.importance
    )
    .map((snip, index) => ({
      ...snip,
      rank: index + 1
    }));
}

/*
|--------------------------------------------------------------------------
| Normalize Directions
|--------------------------------------------------------------------------
*/

function normalizeDirections(directions) {

  if (!Array.isArray(directions)) {
    return [];
  }

  const allowedTypes = [
    "EMOTION",
    "FOCUS",
    "CURIOSITY"
  ];

  return directions
    .slice(0, 3)
    .map((direction, index) => {

      const fallbackTypes = [
        "EMOTION",
        "FOCUS",
        "CURIOSITY"
      ];

      const type =
        allowedTypes.includes(
          direction?.type
        )
          ? direction.type
          : fallbackTypes[index];

      const names = {
        EMOTION: "Emotion Burst",
        FOCUS: "Extreme Focus",
        CURIOSITY: "Curiosity Gap"
      };

      const chineseNames = {
        EMOTION: "情绪爆发",
        FOCUS: "极致聚焦",
        CURIOSITY: "好奇心缺口"
      };

      return {

        id:
          `direction-${index + 1}`,

        type,

        name:
          names[type],

        cn:
          chineseNames[type],

        why:
          cleanString(
            direction?.why
          ),

        visualDirection:
          cleanString(
            direction?.visualDirection
          ),

        subject:
          cleanString(
            direction?.subject
          ),

        composition:
          cleanString(
            direction?.composition
          ),

        mood:
          cleanString(
            direction?.mood
          ),

        strategy:
          cleanString(
            direction?.strategy
          )

      };

    });
}

/*
|--------------------------------------------------------------------------
| System Prompt
|--------------------------------------------------------------------------
*/

function buildSystemPrompt({
  intent,
  contentType,
  fileName
}) {

  return `
You are Snips.

Snips is an AI creative director for video covers.

Your job is NOT simply to describe an image.

Your job is to:

1. Understand the actual visual content.
2. Identify the strongest visual opportunities.
3. Extract those opportunities as "Snips".
4. Rank them by cover potential.
5. Turn them into three genuinely different cover strategies.

The final result should help a cover designer decide:

"What should I show?"

"Where should I place it?"

"What should dominate?"

"Why would someone want to click?"

--------------------------------------------------
USER CONTEXT
--------------------------------------------------

User's desired feeling:

${intent || "没有特别指定"}

Content type:

${contentType || "unknown"}

File name:

${fileName || "未提供"}

--------------------------------------------------
IMPORTANT VISUAL RULE
--------------------------------------------------

You MUST inspect the actual image.

Never invent:

- people
- faces
- objects
- text
- colors
- environments
- actions
- emotions
- composition
- lighting
- details

that are not actually visible.

If something is uncertain, do not pretend it is certain.

--------------------------------------------------
LAYER 1 — SNIPS
--------------------------------------------------

Find exactly 5 visually meaningful Snips.

A Snip is a visual opportunity that could contribute to a strong
video cover.

A Snip can be:

- a face
- facial expression
- body pose
- action
- distinctive object
- visual detail
- text element
- contrast
- color relationship
- negative space
- gaze direction
- visual tension
- unusual shape
- strong composition
- recognizable visual element
- information that creates curiosity

Do NOT simply list five objects.

Think like a professional thumbnail designer.

Each Snip must answer:

"What makes this useful for a cover?"

The importance score must represent cover potential.

Use:

0.90 - 1.00
Extremely strong visual opportunity.

0.75 - 0.89
Strong visual opportunity.

0.50 - 0.74
Useful but secondary.

0.25 - 0.49
Weak opportunity.

0.00 - 0.24
Very weak opportunity.

--------------------------------------------------
LAYER 2 — COVER DIRECTIONS
--------------------------------------------------

Create exactly THREE different cover directions.

They MUST use different psychological and visual mechanisms.

==================================================
DIRECTION 1 — EMOTION
==================================================

Type:

EMOTION

Name:

Emotion Burst

Goal:

Maximize immediate emotional impact.

Think about:

- emotional expression
- tension
- reaction
- dramatic scale
- visual intensity
- emotional contrast

The result should make the viewer feel something immediately.

==================================================
DIRECTION 2 — FOCUS
==================================================

Type:

FOCUS

Name:

Extreme Focus

Goal:

Make one visual subject dominate the entire cover.

Think about:

- removing distractions
- large subject
- strong hierarchy
- simplified composition
- strong silhouette
- instant recognition
- mobile-size readability

This direction should be visually cleaner than Emotion.

==================================================
DIRECTION 3 — CURIOSITY
==================================================

Type:

CURIOSITY

Name:

Curiosity Gap

Goal:

Create a reason to click because something feels unresolved.

Think about:

- unanswered question
- partial information
- visual contradiction
- hidden information
- before/after implication
- unusual relationship
- something that makes the viewer wonder

Do NOT invent information that is not visible.

The curiosity mechanism must come from the actual image.

--------------------------------------------------
IMPORTANT
--------------------------------------------------

The three directions MUST NOT be variations of the same composition.

They should feel like three different creative routes.

For example:

Emotion
= "Feel this."

Focus
= "Look at this."

Curiosity
= "What is happening here?"

--------------------------------------------------
OUTPUT
--------------------------------------------------

Return VALID JSON ONLY.

Do not use Markdown.

Do not use code fences.

Do not add explanations outside JSON.

Use exactly this structure:

{
  "snips": [
    {
      "label": "",
      "reason": "",
      "importance": 0
    },
    {
      "label": "",
      "reason": "",
      "importance": 0
    },
    {
      "label": "",
      "reason": "",
      "importance": 0
    },
    {
      "label": "",
      "reason": "",
      "importance": 0
    },
    {
      "label": "",
      "reason": "",
      "importance": 0
    }
  ],

  "directions": [
    {
      "type": "EMOTION",
      "name": "Emotion Burst",
      "cn": "情绪爆发",
      "why": "",
      "visualDirection": "",
      "subject": "",
      "composition": "",
      "mood": "",
      "strategy": ""
    },

    {
      "type": "FOCUS",
      "name": "Extreme Focus",
      "cn": "极致聚焦",
      "why": "",
      "visualDirection": "",
      "subject": "",
      "composition": "",
      "mood": "",
      "strategy": ""
    },

    {
      "type": "CURIOSITY",
      "name": "Curiosity Gap",
      "cn": "好奇心缺口",
      "why": "",
      "visualDirection": "",
      "subject": "",
      "composition": "",
      "mood": "",
      "strategy": ""
    }
  ]
}

--------------------------------------------------
LANGUAGE
--------------------------------------------------

Answer in Chinese.

Keep the English direction names exactly as provided.

--------------------------------------------------
QUALITY
--------------------------------------------------

Every recommendation must be visually actionable.

Avoid generic phrases such as:

"更加吸引人"

"提高点击率"

"增强视觉效果"

unless you explain exactly HOW.

Prefer concrete instructions such as:

"将主体放大至画面约 60%，压缩背景信息"

"保留右侧负空间，将主体视觉重量集中在左侧"

"裁掉次要元素，让主标题成为唯一高对比区域"

--------------------------------------------------
FINAL CHECK
--------------------------------------------------

Before returning JSON, verify:

1. Exactly 5 Snips.
2. Exactly 3 directions.
3. Snips are based on the actual image.
4. importance is between 0 and 1.
5. Emotion, Focus and Curiosity are meaningfully different.
6. No invented visual information.
7. Valid JSON.
8. No Markdown.
9. No text outside JSON.
`;
}

/*
|--------------------------------------------------------------------------
| API Handler
|--------------------------------------------------------------------------
*/

export default async function handler(req, res) {

  const startTime = Date.now();

  console.log(
    "[Snips] =================================="
  );

  console.log(
    "[Snips] API request started"
  );

  /*
   * Method
   */

  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  }

  try {

    /*
     * Body
     */

    const body =
      req.body || {};

    const intent =
      typeof body.intent === "string"
        ? body.intent.trim()
        : "";

    const contentType =
      body.contentType ||
      "unknown";

    const fileName =
      body.fileName ||
      "";

    /*
     * Images
     */

    let images = [];

    /*
     * Primary format:
     *
     * images: []
     */

    if (
      Array.isArray(body.images)
    ) {

      images =
        body.images.filter(
          isValidImageDataUrl
        );

    }

    /*
     * Backward compatibility:
     *
     * imageData: ""
     */

    if (
      images.length === 0 &&
      isValidImageDataUrl(
        body.imageData
      )
    ) {

      images = [
        body.imageData
      ];

    }

    console.log(
      "[Snips] intent:",
      Boolean(intent)
    );

    console.log(
      "[Snips] images:",
      images.length
    );

    /*
     * Validate intent
     */

    if (!intent) {

      return res.status(400).json({
        success: false,
        error:
          "请输入你希望封面呈现的感觉"
      });

    }

    /*
     * Validate image
     */

    if (
      images.length === 0
    ) {

      return res.status(400).json({
        success: false,
        error:
          "没有收到有效图片，请重新上传"
      });

    }

    /*
     * Limit number
     */

    images =
      images.slice(
        0,
        MAX_IMAGES
      );

    /*
     * Calculate total size
     */

    const totalImageSize =
      images.reduce(
        (total, image) =>
          total + image.length,
        0
      );

    console.log(
      "[Snips] total image size:",
      totalImageSize
    );

    /*
     * Protect Vercel request
     */

    if (
      totalImageSize >
      MAX_TOTAL_IMAGE_SIZE
    ) {

      return res.status(413).json({
        success: false,
        error:
          "图片数据过大，请压缩图片后重新上传"
      });

    }

    /*
     * System prompt
     */

    const systemPrompt =
      buildSystemPrompt({
        intent,
        contentType,
        fileName
      });

    /*
     * User content
     */

    const userContent = [

      {
        type: "input_text",

        text: `
Analyze the actual uploaded image(s).

User desired feeling:

${intent}

Return exactly:

- 5 Snips
- 3 cover directions

The three directions must be:

1. Emotion Burst
2. Extreme Focus
3. Curiosity Gap

Do not invent visual information.
        `.trim()

      }

    ];

    /*
     * Add images
     */

    for (
      const image of images
    ) {

      userContent.push({

        type: "input_image",

        image_url: image

      });

    }

    console.log(
      "[Snips] Calling OpenAI..."
    );

    /*
     * OpenAI
     */

    const response =
      await client.responses.create({

        model: MODEL,

        input: [

          {
            role: "system",

            content: [

              {
                type: "input_text",

                text: systemPrompt

              }

            ]

          },

          {
            role: "user",

            content: userContent

          }

        ],

        reasoning: {
          effort: "low"
        }

      });

    /*
     * Response text
     */

    const text =
      typeof response.output_text === "string"
        ? response.output_text.trim()
        : "";

    console.log(
      "[Snips] OpenAI response received"
    );

    console.log(
      "[Snips] output length:",
      text.length
    );

    /*
     * Empty response
     */

    if (!text) {

      return res.status(502).json({
        success: false,
        error:
          "AI 没有返回内容"
      });

    }

    /*
     * Parse JSON
     */

    const rawResult =
      extractJson(text);

    if (!rawResult) {

      console.error(
        "[Snips] Unable to parse JSON"
      );

      console.error(
        "[Snips] Raw output:",
        text.slice(0, 5000)
      );

      return res.status(502).json({

        success: false,

        error:
          "AI 返回的数据格式异常",

        raw:
          text.slice(0, 5000)

      });

    }

    /*
     * Normalize
     */

    const snips =
      normalizeSnips(
        rawResult.snips
      );

    const directions =
      normalizeDirections(
        rawResult.directions
      );

    /*
     * Validate counts
     */

    if (
      snips.length !== 5
    ) {

      console.error(
        "[Snips] Invalid Snips count:",
        snips.length
      );

      return res.status(502).json({

        success: false,

        error:
          `AI 返回了 ${snips.length} 个 Snips，需要 5 个`,

        partialResult: {
          snips,
          directions
        }

      });

    }

    if (
      directions.length !== 3
    ) {

      console.error(
        "[Snips] Invalid direction count:",
        directions.length
      );

      return res.status(502).json({

        success: false,

        error:
          `AI 返回了 ${directions.length} 个方向，需要 3 个`,

        partialResult: {
          snips,
          directions
        }

      });

    }

    /*
     * Ensure direction order
     */

    const directionOrder = [
      "EMOTION",
      "FOCUS",
      "CURIOSITY"
    ];

    directions.sort(
      (a, b) =>
        directionOrder.indexOf(a.type) -
        directionOrder.indexOf(b.type)
    );

    /*
     * Final result
     */

    const elapsed =
      Date.now() - startTime;

    const result = {

      success: true,

      model: MODEL,

      imageCount:
        images.length,

      processingTime:
        elapsed,

      snips,

      directions

    };

    console.log(
      "[Snips] SUCCESS"
    );

    console.log(
      "[Snips] Snips:",
      snips.length
    );

    console.log(
      "[Snips] Directions:",
      directions.length
    );

    console.log(
      "[Snips] Time:",
      `${elapsed}ms`
    );

    console.log(
      "[Snips] =================================="
    );

    return res.status(200).json(result);

  } catch (error) {

    const elapsed =
      Date.now() - startTime;

    console.error(
      "[Snips] =================================="
    );

    console.error(
      "[Snips] ERROR"
    );

    console.error(
      "[Snips] Time:",
      `${elapsed}ms`
    );

    console.error(
      "[Snips] Status:",
      error?.status
    );

    console.error(
      "[Snips] Message:",
      error?.message
    );

    console.error(
      "[Snips] Full error:",
      error
    );

    console.error(
      "[Snips] =================================="
    );

    /*
     * OpenAI error
     */

    const status =
      Number.isInteger(
        error?.status
      )
        ? error.status
        : 500;

    let message =
      error?.message ||
      "AI 调用失败";

    /*
     * Friendly messages
     */

    if (status === 401) {

      message =
        "OpenAI API Key 无效或未正确配置";

    }

    if (status === 403) {

      message =
        "OpenAI API 没有访问权限";

    }

    if (status === 404) {

      message =
        "OpenAI 模型不存在或当前项目没有访问权限";

    }

    if (status === 429) {

      message =
        "OpenAI API 当前达到额度或请求限制，请稍后再试";

    }

    if (status === 413) {

      message =
        "请求数据过大，请压缩图片后重试";

    }

    return res.status(status).json({

      success: false,

      error: message,

      status,

      processingTime:
        elapsed

    });

  }

}
