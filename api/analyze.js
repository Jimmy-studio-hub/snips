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

      model: "gpt-5.6-luna",

      input: [

        {
          role: "system",

          content: `
You are Snips, an AI creative director specialized in video covers.

Your job is to understand the user's desired visual feeling and turn it into a practical cover strategy.

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

- Answer in Chinese.
- Keep every field concise.
- Do not use generic marketing language.
- Make the recommendations visually actionable.
- Think like a professional cover designer.
- Focus on clickability, visual hierarchy, subject emphasis and curiosity.
- Do not invent information about the user's actual video because no video has been analyzed yet.
- Treat the user's input as the desired creative direction.
          `,
        },

        {
          role: "user",

          content:
            `用户希望封面呈现的感觉：${intent}`,
        },

      ],

    });


    const text =
      response.output_text;


    let result;


    try {

      result =
        JSON.parse(text);

    } catch {

      result = {

        visualDirection:text,

        subject:"",

        composition:"",

        mood:"",

        strategy:"",

      };

    }


    return res.status(200).json(result);


  } catch (error) {

    console.error("OpenAI API Error:", error);


    return res.status(500).json({

      error:
        error?.message ||
        "AI 调用失败，请稍后重试",

    });

  }

}
