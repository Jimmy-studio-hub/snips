/*
|--------------------------------------------------------------------------
| Snips V3 Engine - API: Extract Frames
|--------------------------------------------------------------------------
| 视频抽帧 API
|
| 两种模式：
| 1. 服务端抽帧：接收视频URL，使用ffmpeg抽取关键帧（需要ffmpeg可用）
| 2. 帧透传模式：接收前端已抽好的帧（canvas抽帧），验证并返回标准化格式
|
| 推荐：前端使用canvas抽帧（性能更好，无服务端限制），此API用于验证和标准化
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| 配置
|--------------------------------------------------------------------------
*/

const CONFIG = {
  // 最大抽帧数量
  MAX_FRAMES: 60,

  // 默认抽帧间隔（秒）
  DEFAULT_INTERVAL: 1.0,

  // 单帧最大尺寸（长边）
  MAX_FRAME_DIMENSION: 1280,

  // 单帧最大大小（字节）
  MAX_FRAME_SIZE: 500 * 1024,

  // 支持的视频格式
  SUPPORTED_VIDEO_TYPES: ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"],
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

function isValidVideoUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function getDataUrlSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

/**
 * 使用sharp压缩帧（如果可用）
 */
async function compressFrame(dataUrl, maxSize = CONFIG.MAX_FRAME_SIZE) {
  if (getDataUrlSize(dataUrl) <= maxSize) return dataUrl;

  try {
    const sharp = (await import("sharp")).default;
    const buffer = Buffer.from(dataUrl.split(",")[1], "base64");

    let quality = 85;
    let result = buffer;

    while (result.length > maxSize && quality > 30) {
      result = await sharp(buffer)
        .resize(CONFIG.MAX_FRAME_DIMENSION, CONFIG.MAX_FRAME_DIMENSION, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .toBuffer();
      quality -= 15;
    }

    return `data:image/jpeg;base64,${result.toString("base64")}`;
  } catch {
    return dataUrl;
  }
}

/*
|--------------------------------------------------------------------------
| 帧验证和标准化
|--------------------------------------------------------------------------
*/

/**
 * 验证并标准化帧数组
 */
async function normalizeFrames(frames) {
  if (!Array.isArray(frames)) {
    throw new Error("frames 必须是数组");
  }

  if (frames.length === 0) {
    throw new Error("frames 数组不能为空");
  }

  if (frames.length > CONFIG.MAX_FRAMES) {
    console.warn(`[ExtractFrames] 帧数量超过上限 ${CONFIG.MAX_FRAMES}，将截取前 ${CONFIG.MAX_FRAMES} 帧`);
    frames = frames.slice(0, CONFIG.MAX_FRAMES);
  }

  const normalized = [];
  const errors = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    // 支持两种格式：{ dataUrl, timestamp } 或 纯dataUrl字符串
    const dataUrl = typeof frame === "string" ? frame : frame.dataUrl;
    const timestamp = typeof frame === "string" ? i * CONFIG.DEFAULT_INTERVAL : (frame.timestamp ?? i * CONFIG.DEFAULT_INTERVAL);

    if (!isValidDataUrl(dataUrl)) {
      errors.push({ index: i, reason: "无效的图片dataUrl格式" });
      continue;
    }

    // 压缩帧
    const compressed = await compressFrame(dataUrl);

    normalized.push({
      index: i,
      timestamp: Number(timestamp) || i * CONFIG.DEFAULT_INTERVAL,
      dataUrl: compressed,
      size: getDataUrlSize(compressed),
    });
  }

  if (normalized.length === 0) {
    throw new Error("没有有效的帧数据");
  }

  return { frames: normalized, errors, totalInput: frames.length };
}

/*
|--------------------------------------------------------------------------
| 服务端抽帧（需要ffmpeg）
|--------------------------------------------------------------------------
*/

async function extractFramesFromVideo(videoUrl, options = {}) {
  const { interval = CONFIG.DEFAULT_INTERVAL, maxFrames = CONFIG.MAX_FRAMES } = options;

  // 尝试使用ffmpeg-static
  let ffmpegPath = null;
  try {
    const ffmpegStatic = await import("ffmpeg-static");
    ffmpegPath = ffmpegStatic.default;
  } catch {
    // ffmpeg-static 不可用
  }

  if (!ffmpegPath) {
    throw new Error(
      "服务端抽帧需要 ffmpeg-static 依赖。建议使用前端canvas抽帧模式，或安装 ffmpeg-static 依赖。"
    );
  }

  // 这里是ffmpeg抽帧的实现框架
  // 实际使用时需要：
  // 1. 下载视频到临时文件
  // 2. 使用ffmpeg抽帧
  // 3. 转换为base64返回
  // 由于Vercel serverless限制，此功能可能需要配置

  throw new Error("服务端抽帧功能需要额外配置，请使用前端canvas抽帧模式");
}

/*
|--------------------------------------------------------------------------
| Vercel Serverless Function Handler
|--------------------------------------------------------------------------
*/

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

  try {
    const { mode, videoUrl, frames, interval, maxFrames } = req.body || {};

    console.log(`[ExtractFrames] 请求: mode=${mode || "auto"}, frames=${frames?.length || 0}, videoUrl=${videoUrl ? "provided" : "none"}`);

    let result;

    if (mode === "server" && videoUrl) {
      // 服务端抽帧模式
      if (!isValidVideoUrl(videoUrl)) {
        return res.status(400).json({ error: "无效的视频URL" });
      }
      result = await extractFramesFromVideo(videoUrl, { interval, maxFrames });
    } else if (frames) {
      // 帧透传/标准化模式（推荐）
      result = await normalizeFrames(frames);
    } else if (videoUrl) {
      // 自动模式：有videoUrl尝试服务端抽帧
      try {
        result = await extractFramesFromVideo(videoUrl, { interval, maxFrames });
      } catch (error) {
        return res.status(501).json({
          error: error.message,
          suggestion: "请使用前端canvas抽帧后，将帧数据发送到此API的frames参数",
        });
      }
    } else {
      return res.status(400).json({
        error: "缺少必要参数",
        required: "frames（推荐，前端canvas抽帧后的数组）或 videoUrl",
      });
    }

    return res.status(200).json({
      success: true,
      ...result,
      config: {
        maxFrames: CONFIG.MAX_FRAMES,
        maxFrameSize: CONFIG.MAX_FRAME_SIZE,
        defaultInterval: CONFIG.DEFAULT_INTERVAL,
      },
    });
  } catch (error) {
    console.error("[ExtractFrames] 错误:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
}
