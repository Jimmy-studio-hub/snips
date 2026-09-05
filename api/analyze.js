import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const { intent } = req.body || {};

    if (!intent || !intent.trim()) {
      return res.status(400).json({
        error: "请输入你希望封面呈现的感觉",
      });
    }

    const response = await client.responses.create({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content: `
You are Snips, an AI cover creative director.

Your job is to turn the user's desired feeling into a strong video-cover strategy.

Return JSON only with exactly these fields:
{
  "visualDirection": "",
  "subject": "",
  "composition": "",
  "mood": "",
  "strategy": ""
}

Keep each field concise and practical.
Do not generate generic marketing language.
          `,
        },
        {
          role: "user",
          content: `用户希望封面呈现的感觉：${intent}`,
        },
      ],
    });

    const text = response.output_text;

    let result;

    try {
      result = JSON.parse(text);
    } catch {
      result = {
        visualDirection: text,
        subject: "",
        composition: "",
        mood: "",
        strategy: "",
      };
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "AI 调用失败，请稍后重试",
    });
  }
}
