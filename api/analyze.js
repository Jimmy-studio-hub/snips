import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const body = req.body || {};

    const intent =
      typeof body.intent === "string"
        ? body.intent.trim()
        : "";

    const contentType =
      body.contentType || "unknown";

    const fileName =
      body.fileName || "";

    /*
     * 兼容两种前端传参方式：
     *
     * imageData: "data:image/..."
     *
     * images: [
     *   "data:image/..."
     * ]
     */

    let images = [];

    if (
      Array.isArray(body.images)
    ) {
      images = body.images.filter(
        item =>
          typeof item === "string" &&
          item.startsWith("data:image/")
      );
    }

    if (
      images.length === 0 &&
      typeof body.imageData === "string" &&
      body.imageData.startsWith("data:image/")
    ) {
      images = [body.imageData];
    }

    if (!intent) {
      return res.status(400).json({
        error: "请输入你希望封面呈现的感觉"
      });
    }

    if (images.length === 0) {
      return res.status(400).json({
        error: "没有收到图片，请重新上传图片后再测试"
      });
    }

    /*
     * 防止一次传入过多图片
     */

    images = images.slice(0, 5);

    /*
     * 防止异常大的请求
     */

    const totalImageSize = images.reduce(
      (total, image) => total + image.length,
      0
    );

    if (totalImageSize > 20 * 1024 * 1024) {
      return res.status(413).json({
        error: "图片数据过大，请使用较小的图片"
      });
    }

    const systemPrompt = `
You are Snips.

Snips is an AI creative director specialized in high-click video covers.

Your job is to analyze the ACTUAL IMAGE provided by the user.

You must visually inspect the image before generating your answer.

Never invent:
- people
- objects
- expressions
- colors
- actions
- environments
- composition
- text
- visual details

Everything you describe must be grounded in what is actually visible.

USER INTENT:

${intent}

CONTENT TYPE:

${contentType}

FILE NAME:

${fileName || "未提供"}

---

LAYER 1 — SNIPS

Find exactly 5 visually meaningful Snips.

A Snip is NOT simply an object.

A Snip may be:

- a face
- facial expression
- body/action
- distinctive object
- strong visual detail
- contrast
- composition
- negative space
- gaze direction
- color relationship
- visual tension
- unusual visual element
- visually dominant area
- potentially clickable moment

Each Snip must explain why it is useful for creating a video cover.

IMPORTANT:

Rank Snips by actual visual importance.

importance must be between 0 and 1.

---

LAYER 2 — COVER DIRECTIONS

Create exactly 3 genuinely different cover directions.

They MUST use different creative mechanisms.

Direction 1:

EMOTION

Focus on emotional impact.

Direction 2:

FOCUS

Focus on visual dominance and immediate recognition.

Direction 3:

CURIOSITY

Focus on information gaps, unanswered questions,
or visual tension.

The three directions must NOT be simple rewrites of each other.

Each direction must be practical for a professional cover designer.

---

OUTPUT

Return JSON ONLY.

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

RULES:

1. Answer in Chinese except fixed English direction names.
2. Be concise.
3. Every Snip must be grounded in the actual image.
4. Every Snip must be useful for cover creation.
5. Do not invent unseen details.
6. Do not use generic marketing language.
7. Focus on visual hierarchy.
8. Focus on clickability.
9. Focus on recognition at small size.
10. Focus on curiosity.
11. The three directions must be visibly different.
12. importance must be a number between 0 and 1.
13. Return valid JSON only.
`;

    /*
     * 创建 Vision 输入
     */

    const userContent = [
      {
        type: "input_text",
        text: `
请分析我提供的实际图片。

用户希望封面呈现：

${intent}

请先观察图片，再生成：

1. 5 个 Snips
2. 3 个不同的封面创意方向

不要假设图片中不存在的内容。
        `
      }
    ];

    /*
     * 添加图片
     */

    for (const image of images) {

      userContent.push({
        type: "input_image",
        image_url: image
      });

    }

    console.log(
      `[Snips AI] Starting analysis. images=${images.length}`
    );

    /*
     * 调用 OpenAI Responses API
     */

    const response = await client.responses.create({
      model: "gpt-5.6-luna",

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

      /*
       * 强制 AI 更快返回
       */

      reasoning: {
        effort: "low"
      }
    });

    console.log(
      "[Snips AI] OpenAI response received"
    );

    const text =
      typeof response.output_text === "string"
        ? response.output_text.trim()
        : "";

    if (!text) {
      return res.status(500).json({
        error: "AI 没有返回内容"
      });
    }

    /*
     * 尝试解析 JSON
     */

    let result;

    try {

      result = JSON.parse(text);

    } catch (parseError) {

      console.error(
        "[Snips AI] JSON parse error:",
        parseError
      );

      console.error(
        "[Snips AI] Raw output:",
        text
      );

      /*
       * 有些情况下模型会返回：

       ```json
       {...}
       ```

       尝试自动清理 Markdown
       */

      try {

        const cleaned =
          text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        result = JSON.parse(cleaned);

      } catch (secondError) {

        return res.status(500).json({
          error: "AI 返回的数据格式异常",
          raw: text.slice(0, 2000)
        });

      }
    }

    /*
     * 数据结构验证
     */

    if (!Array.isArray(result.snips)) {

      return res.status(500).json({
        error: "AI 返回结果缺少 snips"
      });

    }

    if (!Array.isArray(result.directions)) {

      return res.status(500).json({
        error: "AI 返回结果缺少 directions"
      });

    }

    /*
     * 保证前端不会收到异常数量
     */

    result.snips =
      result.snips
        .slice(0, 5)
        .map((snip, index) => ({
          label:
            typeof snip.label === "string"
              ? snip.label
              : `Snip ${index + 1}`,

          reason:
            typeof snip.reason === "string"
              ? snip.reason
              : "",

          importance:
            typeof snip.importance === "number"
              ? Math.max(
                  0,
                  Math.min(1, snip.importance)
                )
              : 0
        }));

    result.directions =
      result.directions
        .slice(0, 3)
        .map(direction => ({
          type:
            direction.type || "",

          name:
            direction.name || "",

          cn:
            direction.cn || "",

          why:
            direction.why || "",

          visualDirection:
            direction.visualDirection || "",

          subject:
            direction.subject || "",

          composition:
            direction.composition || "",

          mood:
            direction.mood || "",

          strategy:
            direction.strategy || ""
        }));

    console.log(
      `[Snips AI] Success. snips=${result.snips.length}, directions=${result.directions.length}`
    );

    return res.status(200).json({
      success: true,
      model: "gpt-5.6-luna",
      imageCount: images.length,
      result
    });

  } catch (error) {

    console.error(
      "[Snips AI] OpenAI API Error:",
      error
    );

    const status =
      error?.status ||
      500;

    return res.status(status).json({
      error:
        error?.message ||
        "AI 调用失败，请检查 OpenAI API 配置"
    });
  }
}
