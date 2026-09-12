/*
|--------------------------------------------------------------------------
| Snips V3 Engine - Creative Strategy Skill
|--------------------------------------------------------------------------
| 基于内容理解和Snip分析，生成三个创意方向
| 输入：contentUnderstanding + topSnips + userIntent
| 输出：三个创意方向（每个包含标题、描述、封面建议、文案建议）
|--------------------------------------------------------------------------
*/

import OpenAI from "openai";

const CONFIG = {
  MODEL: process.env.SNIPS_MODEL || "deepseek-flash",
  MAX_RETRIES: 2,
  TIMEOUT: 60000,
  NUM_DIRECTIONS: 3,
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

function buildPrompt(contentUnderstanding, topSnips, userIntent) {
  const snipsText = topSnips.slice(0, 5).map((s, i) =>
    `Snip${i + 1}: ${s.label} (视觉分:${s.visual_score}, 点击欲:${s.clickability_score}) - ${s.reason}`
  ).join("\n");

  return `你是一位资深的创意总监，擅长为短视频/内容创作制定封面策略。

**用户意图：** ${userIntent || "未指定，基于内容自动生成"}

**内容理解：**
- 核心主题：${contentUnderstanding.core_theme || "未知"}
- 叙事结构：${contentUnderstanding.narrative_arc || "未知"}
- 目标受众：${contentUnderstanding.target_audience || "未知"}
- 内容标签：${(contentUnderstanding.content_tags || []).join(", ")}

**Top Snips（按综合评分排序）：**
${snipsText}

请基于以上信息，生成 ${CONFIG.NUM_DIRECTIONS} 个差异化的创意方向。每个方向需要有明显的风格差异，不要雷同。

每个方向包含：
1. **name（方向名称）**：4-8字，有记忆点
2. **headline（主标题文案）**：封面主标题，15字以内，有冲击力
3. **subheadline（副标题文案）**：辅助说明，20字以内
4. **description（方向描述）**：一句话说明这个方向的核心创意和为什么有效
5. **visual_style（视觉风格）**：色调、构图、字体风格建议
6. **recommended_snip（推荐Snip索引）**：基于哪个Snip制作封面（0-4）
7. **emotional_appeal（情感诉求）**：这个方向主要调动什么情绪
8. **target_audience_fit（受众适配）**：适合哪类受众
9. **risk_note（风险提示）**：这个方向可能存在的问题或注意事项

请严格按JSON格式返回：
{
  "directions": [
    {
      "name": "情绪冲击",
      "headline": "这一幕看哭了",
      "subheadline": "3分钟看懂他的故事",
      "description": "用人物最强烈的情绪瞬间作为封面，引发共情",
      "visual_style": "暖色调、人物特写、大字体标题",
      "recommended_snip": 0,
      "emotional_appeal": "感动/共鸣",
      "target_audience_fit": "情感内容受众",
      "risk_note": "注意不要过度消费情绪"
    }
  ]
}`;
}

/**
 * 创意策略主函数
 */
export async function generateStrategies(contentUnderstanding, topSnips, userIntent) {
  console.log("[CreativeStrategy] 开始生成创意方向...");

  const client = getClient();
  const messages = [{ role: "user", content: buildPrompt(contentUnderstanding, topSnips, userIntent) }];

  let lastError = null;
  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: CONFIG.MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 2500,
      });
      const result = extractJson(response.choices[0]?.message?.content);
      if (result && Array.isArray(result.directions) && result.directions.length > 0) {
        console.log(`[CreativeStrategy] 生成 ${result.directions.length} 个创意方向`);
        return {
          directions: result.directions.slice(0, CONFIG.NUM_DIRECTIONS),
          source: "creative_strategy",
        };
      }
      lastError = new Error("无法解析或方向数量不足");
    } catch (error) {
      lastError = error;
      if (attempt < CONFIG.MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  console.warn("[CreativeStrategy] 生成失败，使用降级模板:", lastError?.message);

  // 降级：生成三个基础方向
  const fallbackDirections = [
    {
      name: "视觉冲击",
      headline: topSnips[0]?.label || "精彩瞬间",
      subheadline: "点击查看完整内容",
      description: "用视觉冲击力最强的画面吸引点击",
      visual_style: "高对比、鲜艳色彩、主体突出",
      recommended_snip: 0,
      emotional_appeal: "好奇/震撼",
      target_audience_fit: "通用受众",
      risk_note: "",
    },
    {
      name: "情绪共鸣",
      headline: "看到最后泪目了",
      subheadline: "一个真实的故事",
      description: "用情绪感染力强的画面引发共鸣",
      visual_style: "暖色调、人物面部、柔和光影",
      recommended_snip: Math.min(1, topSnips.length - 1),
      emotional_appeal: "感动/共情",
      target_audience_fit: "情感内容受众",
      risk_note: "",
    },
    {
      name: "悬念好奇",
      headline: "你绝对猜不到结局",
      subheadline: "全程高能",
      description: "用悬念式文案激发好奇心",
      visual_style: "暗色调、留白、神秘感",
      recommended_snip: Math.min(2, topSnips.length - 1),
      emotional_appeal: "好奇/期待",
      target_audience_fit: "年轻受众",
      risk_note: "",
    },
  ];

  return { directions: fallbackDirections, source: "fallback" };
}

export default { generateStrategies, CONFIG };
