export default async function handler(req, res) {
  console.log("[Snips] API HIT");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    console.log("[Snips] Request received");

    console.log("[Snips] Keys:", Object.keys(body));

    const intent = body.intent || "";

    const images = Array.isArray(body.images)
      ? body.images
      : [];

    const imageData =
      typeof body.imageData === "string"
        ? body.imageData
        : "";

    console.log(
      "[Snips] intent:",
      intent
    );

    console.log(
      "[Snips] images:",
      images.length
    );

    console.log(
      "[Snips] imageData:",
      imageData.length
    );

    return res.status(200).json({
      success: true,
      message: "API 正常工作",
      received: {
        intent: Boolean(intent),
        images: images.length,
        imageData: imageData.length
      }
    });

  } catch (error) {

    console.error(
      "[Snips] ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error?.message || "Unknown error"
    });
  }
}
