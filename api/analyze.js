/*
|--------------------------------------------------------------------------
| Snips V3 Engine - API: Analyze (Main Entry)
|--------------------------------------------------------------------------
| 主分析 API 入口（V3 版本）
|
| 向后兼容：保持与旧版相同的请求/响应格式
| 内部实现：调用 V3 Engine Agent 完整管线
|
| 请求格式：
| {
|   "images": ["data:image/jpeg;base64,..."],  // 图片数组（旧版兼容）
|   "frames": [{ "dataUrl": "...", "timestamp": 1.5 }],  // V3 视频帧
|   "intent": "用户的创意意图",
|   "videoUrl": "https://...",  // 可选
|   "metadata": { ... }
| }
|
| 响应格式（与旧版兼容）：
| {
|   "snips": [{ "label", "reason", "importance", ... }],
|   "directions": [{ "name", "headline", ... }]
| }
|--------------------------------------------------------------------------
*/

import { runV3Pipeline, analyzeImages } from "../agent/snips-agent.js";

/*
|--------------------------------------------------------------------------
| 配置
|--------------------------------------------------------------------------
*/

const CONFIG = {
  MAX_IMAGES: 5,
  MAX_TOTAL_IMAGE_SIZE: 3.5 * 1024 * 1024,
  TIMEOUT: 120000,
};

/*
|--------------------------------------------------------------------------
| 工具函数（保留旧版验证逻辑）
|--------------------------------------------------------------------------
*/

function isValidImageDataUrl(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(value)
  );
}

function getDataUrlSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`分析超时（${ms / 1000}秒）`)), ms)
    ),
  ]);
}

/*
|--------------------------------------------------------------------------
| 友好错误消息（保留旧版）
|--------------------------------------------------------------------------
*/

function getFriendlyErrorMessage(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  let message = error?.message || "AI 分析失败";

  if (status === 401) message = "DeepSeek API Key 无效或未正确配置";
  if (status === 402) message = "DeepSeek API 余额不足，请充值后重试";
  if (status === 403) message = "DeepSeek API 没有访问权限";
  if (status === 404) message = "DeepSeek 模型不存在或当前项目没有访问权限";
  if (status === 408) message = "DeepSeek 请求超时，请稍后重试";
  if (status === 429) message = "DeepSeek API 当前达到请求限制，请稍后再试";
  if (status === 413) message = "请求数据过大，请压缩图片后重试";
  if (status === 504) message = "分析超时，请减少图片数量或降低图片质量后重试";

  return { status, message };
}

/*
|--------------------------------------------------------------------------
| Vercel Serverless Function Handler
|--------------------------------------------------------------------------
*/

export const config = {
  maxDuration: 120,
};

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const startTime = Date.now();

  console.log("[Snips V3] ==================================");
  console.log("[Snips V3] 分析请求开始");

  try {
    /*
     * 解析请求体
     */

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const {
      images = [],
      frames = [],
      intent = "",
      videoUrl = "",
      metadata = {},
      options = {},
    } = body;

    /*
     * 验证输入（兼容旧版 images 格式）
     */

    const inputImages = Array.isArray(images) ? images : [];
    const inputFrames = Array.isArray(frames) ? frames : [];

    if (inputImages.length === 0 && inputFrames.length === 0) {
      console.warn("[Snips V3] 没有输入图片或帧");
      return res.status(400).json({
        error: "请先上传图片或视频帧",
      });
    }

    if (inputImages.length > CONFIG.MAX_IMAGES) {
      console.warn(`[Snips V3] 图片数量超过上限 ${CONFIG.MAX_IMAGES}`);
      return res.status(400).json({
        error: `最多上传 ${CONFIG.MAX_IMAGES} 张图片`,
      });
    }

    // 验证图片格式
    const allImages = inputImages.length > 0 ? inputImages : inputFrames.map((f) => f.dataUrl || f);

    for (let i = 0; i < Math.min(allImages.length, 3); i++) {
      if (!isValidImageDataUrl(allImages[i])) {
        console.warn(`[Snips V3] 第 ${i + 1} 张图片格式无效`);
        return res.status(400).json({
          error: "图片格式不支持，请使用 JPG、PNG 或 WebP 格式",
        });
      }
    }

    // 检查总大小
    const totalSize = allImages.reduce((sum, img) => sum + getDataUrlSize(img), 0);
    if (totalSize > CONFIG.MAX_TOTAL_IMAGE_SIZE) {
      console.warn(`[Snips V3] 图片总大小超过限制: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
      return res.status(413).json({
        error: "图片总大小超过限制，请压缩图片后重试",
      });
    }

    console.log(`[Snips V3] 输入: ${inputImages.length} 图片 / ${inputFrames.length} 帧`);
    console.log(`[Snips V3] 意图: ${intent?.slice(0, 50) || "未指定"}`);
    console.log(`[Snips V3] 总大小: ${(totalSize / 1024).toFixed(1)}KB`);

    /*
     * 调用 V3 Engine 管线
     */

    const result = await withTimeout(
      runV3Pipeline({
        images: inputImages,
        frames: inputFrames,
        intent,
        metadata: {
          ...metadata,
          videoUrl,
          type: inputFrames.length > 0 ? "video" : "image",
        },
        options,
      }),
      CONFIG.TIMEOUT
    );

    const elapsed = Date.now() - startTime;

    console.log(`[Snips V3] Snips: ${result.snips?.length || 0}`);
    console.log(`[Snips V3] Directions: ${result.directions?.length || 0}`);
    console.log(`[Snips V3] Time: ${elapsed}ms`);
    console.log("[Snips V3] ==================================");

    /*
     * 返回结果（兼容旧版格式，同时包含V3扩展字段）
     */

    return res.status(200).json({
      // 旧版兼容字段
      snips: result.snips,
      directions: result.directions,
      // V3 扩展字段
      content_understanding: result.content_understanding,
      pipeline_stats: result.pipeline_stats,
      version: result.version,
      engine: result.engine,
      processing_time_ms: elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;

    console.error("[Snips V3] ==================================");
    console.error("[Snips V3] ERROR");
    console.error("[Snips V3] Time:", `${elapsed}ms`);
    console.error("[Snips V3] Status:", error?.status);
    console.error("[Snips V3] Message:", error?.message);
    console.error("[Snips V3] Full error:", error);
    console.error("[Snips V3] ==================================");

    const { status, message } = getFriendlyErrorMessage(error);

    return res.status(status).json({
      error: message,
      processing_time_ms: elapsed,
    });
  }
}
