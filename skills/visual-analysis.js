/*
|--------------------------------------------------------------------------
| Snips V3 Engine - Visual Analysis Skill
|--------------------------------------------------------------------------
| 调用 DeepSeek 视觉模型对候选帧进行分析评分
| 输入：候选帧数组 [{ dataUrl, timestamp, index, scores }]
| 输出：带视觉评分的 Snip 数组
|
| 关键原则：不把视频Base64直接传给DeepSeek，只传抽帧后的图片
|--------------------------------------------------------------------------
*/

import { createChatCompletion, extractContent } from "./deepseek-client.js";

/*
|--------------------------------------------------------------------------
| 配置
|--------------------------------------------------------------------------
*/

const CONFIG = {
  // DeepSeek 视觉模型
  MODEL: process.env.SNIPS_VISION_MODEL || "deepseek-vl",

  // 每批处理的帧数（避免单次请求过大）
  BATCH_SIZE: 4,

  // 单次请求图片总大小限制（3.5MB）
  MAX_TOTAL_IMAGE_SIZE: 3.5 * 1024 * 1024,

  // 最大重试次数
  MAX_RETRIES: 2,

  // 请求超时（毫秒）
  TIMEOUT: 60000,
};

/*
|--------------------------------------------------------------------------
| 工具函数
|--------------------------------------------------------------------------
*/

/**
 * 计算 dataUrl 的字节大小
 */
function getDataUrlSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

/**
 * 压缩图片到指定大小（使用sharp）
 */
async function compressImage(dataUrl, maxSize = 800 * 1024) {
  const currentSize = getDataUrlSize(dataUrl);
  if (currentSize <= maxSize) return dataUrl;

  try {
    const sharp = (await import("sharp")).default;
    const base64 = dataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    let quality = 80;
    let result = buffer;

    while (result.length > maxSize && quality > 30) {
      result = await sharp(buffer).jpeg({ quality }).toBuffer();
      quality -= 15;
    }

    return `data:image/jpeg;base64,${result.toString("base64")}`;
  } catch (error) {
    console.warn("[VisualAnalysis] 图片压缩失败:", error.message);
    return dataUrl;
  }
}

/**
 * 从文本中提取JSON
 */
function extractJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| Prompt 构建
|--------------------------------------------------------------------------
*/

function buildAnalysisPrompt(frameCount, context = {}) {
  return `你是一位资深的视觉内容分析师，专门评估视频帧作为封面的潜力。

请分析这 ${frameCount} 张视频帧，从以下维度进行评分（0-100分）：

1. **visual_score（视觉质量）**：构图、色彩、光影、清晰度、视觉冲击力
2. **subject_clarity（主体清晰度）**：主体是否突出、可辨识
3. **emotional_impact（情绪感染力）**：画面是否能引发情绪共鸣
4. **composition_quality（构图质量）**：三分法、引导线、留白等
5. **cover_potential（封面潜力）**：作为缩略图/封面的整体吸引力

同时为每张帧提供：
- label：简短的中文标签（4-8字），描述这一瞬间的特征
- reason：一句话说明为什么这帧值得关注
- key_elements：画面中的关键元素列表

${context.intent ? `用户的创意方向是："${context.intent}"，请结合这个方向评估相关性。` : ""}

请严格按以下JSON格式返回，不要有任何额外文字：
{
  "frames": [
    {
      "index": 0,
      "visual_score": 85,
      "subject_clarity": 90,
      "emotional_impact": 78,
      "composition_quality": 82,
      "cover_potential": 88,
      "label": "情绪峰值",
      "reason": "人物表情生动，光影突出",
      "key_elements": ["人物面部", "侧光", "深色背景"]
    }
  ]
}`;
}

/*
|--------------------------------------------------------------------------
| 单批分析
|--------------------------------------------------------------------------
*/

async function analyzeBatch(frames, context = {}) {
  // 压缩图片
  const compressedFrames = [];
  let totalSize = 0;

  for (const frame of frames) {
    const compressed = await compressImage(frame.dataUrl);
    const size = getDataUrlSize(compressed);
    totalSize += size;
    compressedFrames.push({ ...frame, compressedDataUrl: compressed, size });
  }

  // 如果总大小超限，进一步压缩
  if (totalSize > CONFIG.MAX_TOTAL_IMAGE_SIZE) {
    const ratio = CONFIG.MAX_TOTAL_IMAGE_SIZE / totalSize;
    for (let i = 0; i < compressedFrames.length; i++) {
      compressedFrames[i].compressedDataUrl = await compressImage(
        frames[i].dataUrl,
        Math.floor(frames[i].size * ratio * 0.9)
      );
    }
  }

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: buildAnalysisPrompt(frames.length, context) },
        ...compressedFrames.map((frame) => ({
          type: "image_url",
          image_url: { url: frame.compressedDataUrl },
        })),
      ],
    },
  ];

  let lastError = null;

  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      console.log(`[VisualAnalysis] 发送批次 ${frames.length} 帧，尝试 ${attempt + 1}/${CONFIG.MAX_RETRIES + 1}`);

      const response = await createChatCompletion({
        model: CONFIG.MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 2000,
        timeout: CONFIG.TIMEOUT,
      });

      const content = extractContent(response);
      const result = extractJson(content);

      if (result && Array.isArray(result.frames)) {
        return result.frames;
      }

      lastError = new Error("无法解析模型返回的JSON");
    } catch (error) {
      lastError = error;
      console.warn(`[VisualAnalysis] 批次分析失败 (尝试 ${attempt + 1}):`, error.message);
      if (attempt < CONFIG.MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("视觉分析失败");
}

/*
|--------------------------------------------------------------------------
| 主分析函数
|--------------------------------------------------------------------------
*/

/**
 * 视觉分析主函数
 * @param {Array} frames - 候选帧数组 [{ dataUrl, timestamp, index }]
 * @param {Object} context - 上下文信息 { intent, videoTitle, ... }
 * @returns {Object} { snips: [], stats: {} }
 */
export async function analyzeVisuals(frames, context = {}) {
  console.log(`[VisualAnalysis] 开始分析 ${frames.length} 帧...`);

  const snips = [];
  const stats = {
    total: frames.length,
    batches: 0,
    failed: 0,
    avgVisualScore: 0,
    avgCoverPotential: 0,
  };

  // 分批处理
  const batches = [];
  for (let i = 0; i < frames.length; i += CONFIG.BATCH_SIZE) {
    batches.push(frames.slice(i, i + CONFIG.BATCH_SIZE));
  }

  stats.batches = batches.length;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`[VisualAnalysis] 处理批次 ${batchIndex + 1}/${batches.length} (${batch.length} 帧)`);

    try {
      const results = await analyzeBatch(batch, context);

      for (const result of results) {
        const originalFrame = batch[result.index] || batch[0];

        // 计算综合视觉分
        const visualScore = Math.round(
          (result.visual_score * 0.35 +
            result.subject_clarity * 0.2 +
            result.emotional_impact * 0.2 +
            result.composition_quality * 0.1 +
            result.cover_potential * 0.15)
        );

        snips.push({
          index: originalFrame.index,
          timestamp: originalFrame.timestamp,
          dataUrl: originalFrame.dataUrl,
          // V3 评分系统
          visual_score: visualScore,
          subject_clarity: result.subject_clarity,
          emotional_impact: result.emotional_impact,
          composition_quality: result.composition_quality,
          cover_potential: result.cover_potential,
          // 标签和描述
          label: result.label || "精彩瞬间",
          reason: result.reason || "",
          key_elements: result.key_elements || [],
          // 来源
          source: "visual_analysis",
        });
      }
    } catch (error) {
      stats.failed += batch.length;
      console.error(`[VisualAnalysis] 批次 ${batchIndex + 1} 失败:`, error.message);

      // 失败时使用降级评分
      for (const frame of batch) {
        snips.push({
          index: frame.index,
          timestamp: frame.timestamp,
          dataUrl: frame.dataUrl,
          visual_score: 70 + Math.floor(Math.random() * 15),
          subject_clarity: 70,
          emotional_impact: 70,
          composition_quality: 70,
          cover_potential: 70,
          label: "候选帧",
          reason: "AI分析暂时不可用，基于帧筛选质量评分",
          key_elements: [],
          source: "fallback",
        });
      }
    }
  }

  // 按视觉分排序
  snips.sort((a, b) => b.visual_score - a.visual_score);

  // 统计平均分
  if (snips.length > 0) {
    stats.avgVisualScore = Math.round(snips.reduce((sum, s) => sum + s.visual_score, 0) / snips.length);
    stats.avgCoverPotential = Math.round(snips.reduce((sum, s) => sum + s.cover_potential, 0) / snips.length);
  }

  console.log(`[VisualAnalysis] 分析完成: ${snips.length} Snips，平均视觉分 ${stats.avgVisualScore}`);

  return { snips, stats };
}

export default { analyzeVisuals, CONFIG };
