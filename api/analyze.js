import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {

  // 只允许 POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const {
      intent,
      contentType = "unknown",
      fileName = ""
    } = req.body || {};

    // 检查用户输入
    if (!intent || !intent.trim()) {
      return res.status(400).json({
        error: "请输入你希望封面呈现的感觉"
      });
    }

    /*
      第一阶段：
      AI 只分析用户想要的视觉方向。

      现在还没有真正读取视频画面，
      所以绝对不让 AI 假装自己已经看过视频。
    */

    const response = await client.responses.create({

      model: "gpt-5.6-luna",

      input: [

        {
          role: "system",

          content: `
You are Snips.

Snips is an AI creative director for video covers.

Your job is to transform the user's desired feeling into a strong,
practical and visually actionable cover strategy.

IMPORTANT:

At this stage, you have NOT actually seen the user's video or images.

Therefore:

- Never pretend that you analyzed the actual video.
- Never invent scenes, people, objects or emotions from the content.
- Only analyze the user's requested creative direction.
- Explain what kind of visual treatment should be used.
- Think like a professional video-cover designer.

Return JSON only.

The JSON must contain exactly these fields:

{
  "visualDirection": "",
  "subject": "",
  "composition": "",
  "mood": "",
  "strategy": ""
}

Rules:

1. Answer in Chinese.
2. Keep each field concise.
3. Avoid generic marketing language.
4. Make every recommendation visually actionable.
5. Focus on clickability.
6. Focus on visual hierarchy.
7. Focus on subject emphasis.
8. Focus on curiosity.
9. Do not invent information about the actual content.
10. The result should feel like a professional creative direction,
not an advertisement.

Field meanings:

visualDirection:
The overall visual idea.

subject:
What should become the visual focus.

composition:
How the main subject and empty space should be arranged.

mood:
The emotional atmosphere.

strategy:
The core reason this direction may increase the desire to click.
          `
        },

        {
          role: "user",

          content: `
用户希望封面呈现的感觉：

${intent}

内容类型：

${contentType}

内容名称：

${fileName || "未提供"}
          `
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
        parseError
      );

      result = {
        visualDirection: text,
        subject: "",
        composition: "",
        mood: "",
        strategy: ""
      };

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
