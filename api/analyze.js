import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {

  console.log("[Snips] API HIT");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const body = req.body || {};

    const intent =
      typeof body.intent === "string"
        ? body.intent
        : "";

    const images =
      Array.isArray(body.images)
        ? body.images
        : [];

    console.log(
      "[Snips] images:",
      images.length
    );

    if (!images.length) {
      return res.status(400).json({
        error: "没有收到图片"
      });
    }

    const image = images[0];

    if (
      typeof image !== "string" ||
      !image.startsWith("data:image/")
    ) {
      return res.status(400).json({
        error: "图片格式错误"
      });
    }

    console.log(
      "[Snips] image size:",
      image.length
    );

    console.log(
      "[Snips] Calling OpenAI..."
    );

    const response =
      await client.responses.create({

        model: "gpt-5.6-luna",

        input: [
          {
            role: "user",

            content: [

              {
                type: "input_text",

                text: `
请直接分析这张图片。

告诉我：

1. 图片中最明显的主体是什么
2. 画面中最值得作为视频封面的视觉元素是什么
3. 为什么它适合作为封面

用户希望：

${intent || "生成一个具有点击吸引力的视频封面"}

请只返回简洁的中文分析。
                `
              },

              {
                type: "input_image",

                image_url: image
              }

            ]
          }
        ],

        reasoning: {
          effort: "low"
        }

      });

    console.log(
      "[Snips] OpenAI response received"
    );

    const text =
      response.output_text || "";

    console.log(
      "[Snips] Output:",
      text
    );

    return res.status(200).json({

      success: true,

      message: "OpenAI Vision 正常工作",

      model: "gpt-5.6-luna",

      imageReceived: true,

      imageSize: image.length,

      analysis: text

    });

  } catch (error) {

    console.error(
      "[Snips] OpenAI ERROR:"
    );

    console.error(error);

    return res.status(
      error?.status || 500
    ).json({

      success: false,

      error:
        error?.message ||
        "OpenAI 调用失败",

      status:
        error?.status || 500

    });

  }

}
