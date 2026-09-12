/*
|--------------------------------------------------------------------------
| Snips V3 Engine - API: Analyze Video
|--------------------------------------------------------------------------
| 视频分析 API 入口
| 接收前端抽好的视频帧，调用 V3 Engine 完整管线
|
| 请求格式：
| {
|   "frames": [{ "dataUrl": "...", "timestamp": 1.5, "index": 0 }],
|   "intent": "用户的创意意图",
|   "metadata": { "title": "...", "duration": 120, "type": "video" }
| }
|
| 响应格式（与前端 index.html 兼容）：
| {
|   "snips": [...],
|   "directions": [...],
|   "content_understanding": {...},
|   "pipeline_stats": {...}
| }
|--------------------------------------------------------------------------
*/

import { runV3Pipeline } from "../agent/snips-agent.js";

/*
|--------------------------------------------------------------------------
| 配置
|--------------------------------------------------------------------------
*/

const CONFIG = {
  // 最大请求体大小（字节）
  MAX_BODY_SIZE: 25 * 1024 * 1024, // 25MB

  // 最大帧数量
  MAX_FRAMES: 60,

  // 执行超时（毫秒）
  TIMEOUT: 120000, // 2分钟
};

/*
|--------------------------------------------------------------------------
| 工具函数
|--------------------------------------------------------------------------
*/

function isValidDataUrl(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value)
  );
}

function validateInput(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["请求体必须是JSON对象"];
  }

  const { frames, images } = body;

  if (!frames && !images) {
    errors.push("缺少 frames 或 images 字段");
  }

  if (frames && !Array.isArray(frames)) {
    errors.push("frames 必须是数组");
  }

  if (images && !Array.isArray(images)) {
    errors.push("images 必须是数组");
  }

  const inputFrames = frames || images || [];

  if (inputFrames.length > CONFIG.MAX_FRAMES) {
    errors.push(`帧数量超过上限 ${CONFIG.MAX_FRAMES}`);
  }

  // 验证前几帧的格式
  for (let i = 0; i < Math.min(inputFrames.length, 3); i++) {
    const frame = inputFrames[i];
    const dataUrl = typeof frame === "string" ? frame : frame?.dataUrl;
    if (!isValidDataUrl(dataUrl)) {
      errors.push(`第 ${i + 1} 帧的 dataUrl 格式无效`);
      break;
    }
  }

  return errors;
}

/*
|--------------------------------------------------------------------------
| 超时控制
|--------------------------------------------------------------------------
*/

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
| Vercel Serverless Function Handler
|--------------------------------------------------------------------------
*/

export const config = {
  maxDuration: 120, // Vercel Pro 最大120秒
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
  let requestId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    console.log(`\n[AnalyzeVideo] 请求开始: ${requestId}`);

    // 解析请求体
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: "无效的JSON请求体" });
    }

    // 验证输入
    const validationErrors = validateInput(body);
    if (validationErrors.length > 0) {
      console.warn(`[AnalyzeVideo] 验证失败:`, validationErrors);
      return res.status(400).json({
        error: "输入验证失败",
        details: validationErrors,
      });
    }

    const { frames = [], images = [], intent = "", metadata = {}, options = {} } = body;

    const inputFrames = frames.length > 0 ? frames : images.map((img, i) => ({ dataUrl: img, timestamp: i, index: i }));

    console.log(`[AnalyzeVideo] 输入: ${inputFrames.length} 帧, intent="${intent?.slice(0, 50)}"`);

    // 执行V3 Engine管线
    const result = await withTimeout(
      runV3Pipeline({
        frames: inputFrames,
        intent,
        metadata: {
          ...metadata,
          type: frames.length > 0 ? "video" : "image",
          requestId,
        },
        options,
      }),
      CONFIG.TIMEOUT
    );

    const totalTime = Date.now() - startTime;

    console.log(`[AnalyzeVideo] 完成: ${requestId}, 耗时 ${totalTime}ms`);
    console.log(`[AnalyzeVideo] 输出: ${result.snips?.length || 0} Snips, ${result.directions?.length || 0} 方向`);

    return res.status(200).json({
      success: true,
      requestId,
      processing_time_ms: totalTime,
      ...result,
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[AnalyzeVideo] 错误 (${requestId}, ${totalTime}ms):`, error);

    const statusCode = error.message?.includes("超时") ? 504 : 500;

    return res.status(statusCode).json({
      success: false,
      requestId,
      error: error.message || "Internal server error",
      processing_time_ms: totalTime,
    });
  }
}
