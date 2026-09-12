/*
|--------------------------------------------------------------------------
| Snips V3 Engine - Clickability Analysis Skill
|--------------------------------------------------------------------------
| 分析画面的点击欲（Clickability）：用户看到画面时是否有点击冲动
| 输入：Snip数组（已带视觉评分）
| 输出：带点击欲评分的Snip数组
|
| 点击欲维度：
| - curiosity_gap（好奇心缺口）：画面是否引发好奇
| - emotional_trigger（情绪触发）：是否触发强烈情绪
| - visual_hook（视觉钩子）：是否有吸引眼球的元素
| - text_readability（文字可读性）：缩略图下文字是否清晰
| - platform_fit（平台适配度）：是否适合目标平台
|--------------------------------------------------------------------------
*/

import OpenAI from "openai";

/*
|--------------------------------------------------------------------------
| 配置
|--------------------------------------------------------------------------
*/

const CONFIG = {
  MODEL: process.env.SNIPS_VISION_MODEL || "deepseek-vl",
  BATCH_SIZE: 4,
  MAX_TOTAL_IMAGE_SIZE: 3.5 * 1024 * 1024,
  MAX_RETRIES: 2,
  TIMEOUT: 60000,
};

/*
|--------------------------------------------------------------------------
| 客户端
|--------------------------------------------------------------------------
*/

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || process.env.deepseek_flash,
      baseURL: "https://api.deepseek.com",
      timeout: CONFIG.TIMEOUT,
    });
  }
  return client;
}

/*
|--------------------------------------------------------------------------
| 工具函数
|--------------------------------------------------------------------------
*/

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  return null;
}

function getDataUrlSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

async function compressImage(dataUrl, maxSize = 800 * 1024) {
  if (getDataUrlSize(dataUrl) <= maxSize) return dataUrl;
  try {
    const sharp = (await import("sharp")).default;
    const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
    let quality = 80;
    let result = buffer;
    while (result.length > maxSize && quality > 30) {
      result = await sharp(buffer).jpeg({ quality }).toBuffer();
      quality -= 15;
    }
    return `data:image/jpeg;base64,${result.toString("base64")}`;
  } catch {
    return dataUrl;
  }
}

/*
|--------------------------------------------------------------------------
| Prompt
|--------------------------------------------------------------------------
*/

function buildClickabilityPrompt(snipCount, context = {}) {
  return `你是一位资深的内容运营专家，擅长分析什么画面能让用户忍不住点击。

请分析这 ${snipCount} 张画面的"点击欲"（Clickability）——即用户在信息流中看到这张缩略图时，有多大可能会点击它。

从以下5个维度评分（0-100分）：

1. **curiosity_gap（好奇心缺口）**：画面是否留下悬念、引发好奇？
   - 高分：半遮半露、反常画面、神秘元素、未完成的动作
   - 低分：一目了然、平淡无奇、信息完全暴露

2. **emotional_trigger（情绪触发）**：是否触发强烈情绪？
   - 高分：惊喜、震惊、感动、愤怒、共鸣、反差感
   - 低分：中性、无情绪波动

3. **visual_hook（视觉钩子）**：是否有吸引眼球的元素？
   - 高分：高对比、鲜艳色彩、人物面部特写、动态模糊、 unusual构图
   - 低分：灰暗、模糊、无焦点

4. **text_readability（文字可读性）**：如果画面中有文字，在缩略图尺寸下是否可读？
   - 高分：文字大、对比强、字数少
   - 低分：文字小、模糊、字数多（无文字则给60分中性分）

5. **platform_fit（平台适配度）**：是否适合作为短视频/内容平台的封面？
   - 高分：竖版构图友好、主体居中、有留白可加文字
   - 低分：横版信息密集、边缘重要内容

${context.intent ? `内容主题："${context.intent}"` : ""}
${context.platform ? `目标平台：${context.platform}` : ""}

同时给出：
- clickability_reason：一句话说明这个画面的点击欲核心原因
- improvement_suggestion：如何提升点击欲的具体建议

请严格按JSON格式返回：
{
  "frames": [
    {
      "index": 0,
      "curiosity_gap": 85,
      "emotional_trigger": 90,
      "visual_hook": 78,
      "text_readability": 70,
      "platform_fit": 82,
      "clickability_score": 83,
      "clickability_reason": "人物表情夸张引发好奇",
      "improvement_suggestion": "可以增加文字标题强化悬念"
    }
  ]
}`;
}

/*
|--------------------------------------------------------------------------
| 单批分析
|--------------------------------------------------------------------------
*/

async function analyzeBatch(snips, context = {}) {
  const client = getClient();

  const compressed = [];
  let totalSize = 0;
  for (const snip of snips) {
    const c = await compressImage(snip.dataUrl);
    totalSize += getDataUrlSize(c);
    compressed.push(c);
  }

  if (totalSize > CONFIG.MAX_TOTAL_IMAGE_SIZE) {
    const ratio = CONFIG.MAX_TOTAL_IMAGE_SIZE / totalSize;
    for (let i = 0; i < compressed.length; i++) {
      compressed[i] = await compressImage(snips[i].dataUrl, Math.floor(getDataUrlSize(snips[i].dataUrl) * ratio * 0.9));
    }
  }

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: buildClickabilityPrompt(snips.length, context) },
        ...compressed.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    },
  ];

  let lastError = null;
  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: CONFIG.MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 2000,
      });
      const result = extractJson(response.choices[0]?.message?.content);
      if (result && Array.isArray(result.frames)) return result.frames;
      lastError = new Error("无法解析JSON");
    } catch (error) {
      lastError = error;
      if (attempt < CONFIG.MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

/*
|--------------------------------------------------------------------------
| 主函数
|--------------------------------------------------------------------------
*/

/**
 * 点击欲分析主函数
 * @param {Array} snips - Snip数组（来自visual-analysis）
 * @param {Object} context - 上下文
 * @returns {Object} { snips: [], stats: {} }
 */
export async function analyzeClickability(snips, context = {}) {
  console.log(`[Clickability] 开始分析 ${snips.length} 个Snip的点击欲...`);

  const stats = {
    total: snips.length,
    batches: 0,
    failed: 0,
    avgClickability: 0,
    topClickability: 0,
  };

  const batches = [];
  for (let i = 0; i < snips.length; i += CONFIG.BATCH_SIZE) {
    batches.push(snips.slice(i, i + CONFIG.BATCH_SIZE));
  }
  stats.batches = batches.length;

  const results = [];

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    try {
      const batchResults = await analyzeBatch(batch, context);
      for (const r of batchResults) {
        const original = batch[r.index] || batch[0];
        results.push({
          ...original,
          // 点击欲评分
          clickability_score: r.clickability_score || Math.round(
            (r.curiosity_gap * 0.3 +
              r.emotional_trigger * 0.25 +
              r.visual_hook * 0.2 +
              r.text_readability * 0.1 +
              r.platform_fit * 0.15)
          ),
          curiosity_gap: r.curiosity_gap,
          emotional_trigger: r.emotional_trigger,
          visual_hook: r.visual_hook,
          text_readability: r.text_readability,
          platform_fit: r.platform_fit,
          clickability_reason: r.clickability_reason || "",
          improvement_suggestion: r.improvement_suggestion || "",
        });
      }
    } catch (error) {
      stats.failed += batch.length;
      console.error(`[Clickability] 批次 ${bi + 1} 失败:`, error.message);
      // 降级：基于视觉分估算点击欲
      for (const snip of batch) {
        results.push({
          ...snip,
          clickability_score: Math.min(95, Math.round(snip.visual_score * 0.85 + Math.random() * 10)),
          curiosity_gap: 70,
          emotional_trigger: 70,
          visual_hook: 70,
          text_readability: 65,
          platform_fit: 70,
          clickability_reason: "基于视觉质量估算",
          improvement_suggestion: "",
        });
      }
    }
  }

  // 按点击欲排序
  results.sort((a, b) => b.clickability_score - a.clickability_score);

  if (results.length > 0) {
    stats.avgClickability = Math.round(results.reduce((s, r) => s + r.clickability_score, 0) / results.length);
    stats.topClickability = results[0].clickability_score;
  }

  console.log(`[Clickability] 分析完成: 平均点击欲 ${stats.avgClickability}，最高 ${stats.topClickability}`);

  return { snips: results, stats };
}

export default { analyzeClickability, CONFIG };
