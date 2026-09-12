/*
|--------------------------------------------------------------------------
| Snips V3 Engine - Content Understanding Skill
|--------------------------------------------------------------------------
| 理解视频/图片的整体内容、主题、叙事结构
| 输入：素材元信息 + 关键帧描述
| 输出：内容理解结果（主题、叙事、关键节点、受众分析）
|--------------------------------------------------------------------------
*/

import OpenAI from "openai";

const CONFIG = {
  MODEL: process.env.SNIPS_MODEL || "deepseek-flash",
  MAX_RETRIES: 2,
  TIMEOUT: 45000,
};

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

function buildPrompt(metadata = {}, frameDescriptions = []) {
  const framesText = frameDescriptions.length
    ? frameDescriptions.map((f, i) => `帧${i + 1} (${f.timestamp}s): ${f.label} - ${f.reason}`).join("\n")
    : "（无关键帧描述）";

  return `你是一位资深的内容分析师，请分析以下视频/图片素材的内容。

**素材信息：**
- 标题：${metadata.title || "未知"}
- 描述：${metadata.description || "无"}
- 时长：${metadata.duration ? metadata.duration + "秒" : "未知"}
- 类型：${metadata.type || "未知"}

**关键帧描述：**
${framesText}

请从以下维度进行分析：

1. **core_theme（核心主题）**：一句话概括内容主题
2. **narrative_arc（叙事结构）**：开头-发展-高潮-结尾的结构分析
3. **key_moments（关键节点）**：内容中的重要转折点或高光时刻
4. **target_audience（目标受众）**：分析最可能被吸引的人群
5. **emotional_journey（情绪曲线）**：描述观众情绪的变化轨迹
6. **content_tags（内容标签）**：5-8个关键词标签
7. **tone_style（调性风格）**：内容的整体风格和语气

请严格按JSON格式返回。`;
}

/**
 * 内容理解主函数
 */
export async function understandContent(metadata = {}, frameDescriptions = []) {
  console.log("[ContentUnderstanding] 开始内容理解分析...");

  const client = getClient();
  const messages = [{ role: "user", content: buildPrompt(metadata, frameDescriptions) }];

  let lastError = null;
  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: CONFIG.MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 1500,
      });
      const result = extractJson(response.choices[0]?.message?.content);
      if (result) {
        console.log("[ContentUnderstanding] 分析完成");
        return {
          ...result,
          source: "content_understanding",
        };
      }
      lastError = new Error("无法解析JSON");
    } catch (error) {
      lastError = error;
      if (attempt < CONFIG.MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  console.warn("[ContentUnderstanding] 分析失败，使用降级结果:", lastError?.message);
  return {
    core_theme: metadata.title || "待分析内容",
    narrative_arc: "待分析",
    key_moments: [],
    target_audience: "通用受众",
    emotional_journey: "待分析",
    content_tags: [],
    tone_style: "中性",
    source: "fallback",
  };
}

export default { understandContent, CONFIG };
