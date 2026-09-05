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

    const {
      intent,
      contentType = "unknown",
      fileName = "",
      imageData = ""
    } = req.body || {};

    if (!intent || !intent.trim()) {
      return res.status(400).json({
        error: "请输入你希望封面呈现的感觉"
      });
    }

    /*
     * 图片模式：
     * 前端把图片转换成 Base64 Data URL，
     * 这里直接交给 Vision 模型分析。
     */

    const hasImage =
      typeof imageData === "string" &&
      imageData.startsWith("data:image/");

    const systemPrompt = `
You are Snips.

Snips is an AI creative director specialized in high-click video covers.

Your job is to look at the user's actual visual content,
identify the strongest visual opportunities,
and turn them into practical cover strategies.

IMPORTANT:

If an image is provided, you MUST actually analyze the image.

Never invent objects, people, expressions, colors, composition,
or visual details that are not visible in the image.

The user's requested feeling is:

${intent}

Content type:

${contentType}

File name:

${fileName || "未提供"}

Your analysis has TWO layers.

LAYER 1 — SNIPS

Find exactly 5 visually meaningful "Snips".

A Snip is NOT simply an object in the image.

A Snip can be:

- a face or expression
- a body/action
- a distinctive object
- a strong visual detail
- a contrast
- a composition
- negative space
- a gaze direction
- a color relationship
- a visual tension
- a moment that could become a strong cover

Each Snip must explain WHY it matters for a clickable cover.

LAYER 2 — COVER DIRECTIONS

Create exactly 3 genuinely different cover directions.

The three directions MUST use different creative mechanisms.

Direction 1:
Emotion / emotional impact

Direction 2:
Focus / visual dominance

Direction 3:
Curiosity / information gap

Do NOT simply rewrite the same idea three times.

Each direction must be actionable for a cover designer.

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

Rules:

1. Answer in Chinese except the fixed English direction names.
2. Be concise.
3. Every Snip must be grounded in the actual image.
4. Every Snip must be useful for cover creation.
5. Do not invent unseen details.
6. Do not use generic marketing language.
7. Focus on visual hierarchy.
8. Focus on clickability.
9. Focus on subject recognition at small size.
10. Focus on curiosity.
11. The three directions must feel visibly different.
12. importance must be a number between 0 and 1.
`;

    let inputContent = [
      {
        type: "input_text",
        text: `
请分析这张图片，并根据用户的要求生成 Snips 和三个封面方向。

用户要求：

${intent}
        `
      }
    ];

    /*
     * 只有真正收到图片时才加入 image input。
     */

    if (hasImage) {

      inputContent.push({
        type: "input_image",
        image_url: imageData
      });

    }

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
          content: inputContent
        }
      ]

    });

    const text = response.output_text;

    let result;

    try {

      result = JSON.parse(text);

    } catch (parseError) {

      console.error(
        "JSON parse error:",
        parseError,
        text
      );

      return res.status(500).json({
        error: "AI 返回的数据格式异常"
      });

    }

    /*
     * 基础数据保护
     */

    if (
      !Array.isArray(result.snips) ||
      !Array.isArray(result.directions)
    ) {

      return res.status(500).json({
        error: "AI 返回的数据结构不完整"
      });

    }

    return res.status(200).json(result);

  } catch (error) {

    console.error(
      "OpenAI API Error:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "AI 调用失败，请检查 OpenAI API 配置"
    });

  }

}
