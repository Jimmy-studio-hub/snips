/*
|--------------------------------------------------------------------------
| Snips V3 Engine - Core Agent
|--------------------------------------------------------------------------
| V3 Engine 核心调度器，协调所有Skills执行完整的封面分析流程
|
| 执行管线：
| 1. Frame Selection（帧筛选）- 过滤黑屏/模糊/过曝/重复
| 2. Visual Analysis（视觉分析）- DeepSeek视觉评分
| 3. Clickability Analysis（点击欲分析）- 点击欲评分
| 4. Content Understanding（内容理解）- 主题/叙事/受众分析
| 5. Creative Strategy（创意策略）- 生成三个创意方向
|
| 输出格式与前端 index.html 兼容
|--------------------------------------------------------------------------
*/

import { selectFrames } from "../skills/frame-selection.js";
import { analyzeVisuals } from "../skills/visual-analysis.js";
import { analyzeClickability } from "../skills/clickability.js";
import { understandContent } from "../skills/content-understanding.js";
import { generateStrategies } from "../skills/creative-strategy.js";

/*
|--------------------------------------------------------------------------
| 配置
|--------------------------------------------------------------------------
*/

const CONFIG = {
  // 最大返回Snip数量（前端显示5个）
  MAX_SNIPS: 5,

  // 是否启用各阶段（可通过环境变量控制）
  ENABLE_FRAME_SELECTION: process.env.ENABLE_FRAME_SELECTION !== "false",
  ENABLE_VISUAL_ANALYSIS: process.env.ENABLE_VISUAL_ANALYSIS !== "false",
  ENABLE_CLICKABILITY: process.env.ENABLE_CLICKABILITY !== "false",
  ENABLE_CONTENT_UNDERSTANDING: process.env.ENABLE_CONTENT_UNDERSTANDING !== "false",
  ENABLE_CREATIVE_STRATEGY: process.env.ENABLE_CREATIVE_STRATEGY !== "false",
};

/*
|--------------------------------------------------------------------------
| 工具函数
|--------------------------------------------------------------------------
*/

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 计算Snip综合评分（视觉分 + 点击欲分）
 */
function calculateOverallScore(snip) {
  const visual = snip.visual_score || 70;
  const clickability = snip.clickability_score || 70;
  return Math.round(visual * 0.5 + clickability * 0.5);
}

/**
 * 规范化输出格式，与前端兼容
 */
function normalizeOutput(result) {
  const { snips, directions, contentUnderstanding, pipelineStats } = result;

  // 取Top N Snips
  const topSnips = snips.slice(0, CONFIG.MAX_SNIPS);

  // 转换为前端期望的格式
  const normalizedSnips = topSnips.map((snip, index) => ({
    index,
    label: snip.label || `精彩瞬间 ${index + 1}`,
    reason: snip.reason || snip.clickability_reason || "",
    importance: snip.overall_score || calculateOverallScore(snip),
    // V3 扩展字段
    timestamp: snip.timestamp,
    visual_score: snip.visual_score,
    clickability_score: snip.clickability_score,
    subject_clarity: snip.subject_clarity,
    emotional_impact: snip.emotional_impact,
    composition_quality: snip.composition_quality,
    cover_potential: snip.cover_potential,
    curiosity_gap: snip.curiosity_gap,
    emotional_trigger: snip.emotional_trigger,
    visual_hook: snip.visual_hook,
    key_elements: snip.key_elements || [],
    improvement_suggestion: snip.improvement_suggestion || "",
  }));

  // 规范化方向
  const normalizedDirections = (directions || []).map((dir, index) => ({
    index,
    name: dir.name || `方向 ${index + 1}`,
    headline: dir.headline || "",
    subheadline: dir.subheadline || "",
    description: dir.description || "",
    visual_style: dir.visual_style || "",
    recommended_snip: dir.recommended_snip ?? index,
    emotional_appeal: dir.emotional_appeal || "",
    target_audience_fit: dir.target_audience_fit || "",
    risk_note: dir.risk_note || "",
  }));

  return {
    snips: normalizedSnips,
    directions: normalizedDirections,
    content_understanding: contentUnderstanding || null,
    pipeline_stats: pipelineStats || {},
    version: "v3.0.0",
    engine: "snips-v3-engine",
  };
}

/*
|--------------------------------------------------------------------------
| 主执行函数
|--------------------------------------------------------------------------
*/

/**
 * V3 Engine 完整分析流程
 * @param {Object} input - 输入参数
 * @param {Array} input.frames - 视频帧数组 [{ dataUrl, timestamp, index }]
 * @param {Array} input.images - 图片数组（图片模式）
 * @param {string} input.intent - 用户创意意图
 * @param {Object} input.metadata - 素材元信息
 * @param {Object} input.options - 配置覆盖
 * @returns {Object} 规范化的分析结果
 */
export async function runV3Pipeline(input) {
  const { frames = [], images = [], intent = "", metadata = {}, options = {} } = input;

  const config = { ...CONFIG, ...options };
  const startTime = Date.now();

  const pipelineStats = {
    stages: {},
    total_time_ms: 0,
  };

  console.log("=" .repeat(60));
  console.log("[Snips V3 Engine] 启动分析管线");
  console.log(`[Snips V3 Engine] 输入: ${frames.length} 帧 / ${images.length} 图片, intent="${intent}"`);
  console.log("=" .repeat(60));

  // 统一输入格式
  let inputFrames = frames.length > 0
    ? frames
    : images.map((img, i) => ({ dataUrl: img, timestamp: i * 1.0, index: i }));

  if (inputFrames.length === 0) {
    throw new Error("没有输入帧或图片");
  }

  /*
  |----------------------------------------------------------------------
  | Stage 1: Frame Selection（帧筛选）
  |----------------------------------------------------------------------
  */

  let selectedFrames = inputFrames;
  let frameSelectionStats = null;

  if (config.ENABLE_FRAME_SELECTION && inputFrames.length > 3) {
    console.log("\n[Stage 1] 帧筛选...");
    const stageStart = Date.now();

    try {
      const result = await selectFrames(inputFrames);
      selectedFrames = result.candidates;
      frameSelectionStats = result.stats;

      pipelineStats.stages.frame_selection = {
        status: "success",
        time_ms: Date.now() - stageStart,
        input: inputFrames.length,
        output: selectedFrames.length,
        stats: frameSelectionStats,
      };

      console.log(`[Stage 1] 完成: ${inputFrames.length} → ${selectedFrames.length} 候选帧 (${Date.now() - stageStart}ms)`);
    } catch (error) {
      console.warn("[Stage 1] 帧筛选失败，使用全部帧:", error.message);
      pipelineStats.stages.frame_selection = {
        status: "failed",
        error: error.message,
        time_ms: Date.now() - stageStart,
      };
    }
  } else {
    pipelineStats.stages.frame_selection = { status: "skipped" };
  }

  /*
  |----------------------------------------------------------------------
  | Stage 2: Visual Analysis（视觉分析）
  |----------------------------------------------------------------------
  */

  let snips = [];
  let visualStats = null;

  if (config.ENABLE_VISUAL_ANALYSIS) {
    console.log("\n[Stage 2] 视觉分析...");
    const stageStart = Date.now();

    try {
      const result = await analyzeVisuals(selectedFrames, { intent, ...metadata });
      snips = result.snips;
      visualStats = result.stats;

      pipelineStats.stages.visual_analysis = {
        status: "success",
        time_ms: Date.now() - stageStart,
        input: selectedFrames.length,
        output: snips.length,
        stats: visualStats,
      };

      console.log(`[Stage 2] 完成: ${snips.length} Snips, 平均视觉分 ${visualStats.avgVisualScore} (${Date.now() - stageStart}ms)`);
    } catch (error) {
      console.warn("[Stage 2] 视觉分析失败，使用降级评分:", error.message);
      // 降级：基于帧筛选结果生成基础Snip
      snips = selectedFrames.slice(0, CONFIG.MAX_SNIPS * 2).map((frame, i) => ({
        index: frame.index,
        timestamp: frame.timestamp,
        dataUrl: frame.dataUrl,
        visual_score: 70 + Math.floor(Math.random() * 15),
        subject_clarity: 70,
        emotional_impact: 70,
        composition_quality: 70,
        cover_potential: 70,
        label: `候选帧 ${i + 1}`,
        reason: "视觉分析暂时不可用",
        key_elements: [],
        source: "fallback",
      }));

      pipelineStats.stages.visual_analysis = {
        status: "failed",
        error: error.message,
        time_ms: Date.now() - stageStart,
      };
    }
  } else {
    // 跳过视觉分析，直接生成基础Snip
    snips = selectedFrames.slice(0, CONFIG.MAX_SNIPS * 2).map((frame, i) => ({
      index: frame.index,
      timestamp: frame.timestamp,
      dataUrl: frame.dataUrl,
      visual_score: 75,
      label: `候选帧 ${i + 1}`,
      reason: "",
      key_elements: [],
      source: "skip",
    }));
    pipelineStats.stages.visual_analysis = { status: "skipped" };
  }

  /*
  |----------------------------------------------------------------------
  | Stage 3: Clickability Analysis（点击欲分析）
  |----------------------------------------------------------------------
  */

  let clickabilityStats = null;

  if (config.ENABLE_CLICKABILITY && snips.length > 0) {
    console.log("\n[Stage 3] 点击欲分析...");
    const stageStart = Date.now();

    try {
      const result = await analyzeClickability(snips, { intent, ...metadata });
      snips = result.snips;
      clickabilityStats = result.stats;

      pipelineStats.stages.clickability = {
        status: "success",
        time_ms: Date.now() - stageStart,
        input: snips.length,
        stats: clickabilityStats,
      };

      console.log(`[Stage 3] 完成: 平均点击欲 ${clickabilityStats.avgClickability} (${Date.now() - stageStart}ms)`);
    } catch (error) {
      console.warn("[Stage 3] 点击欲分析失败:", error.message);
      // 降级：基于视觉分估算
      snips = snips.map((s) => ({
        ...s,
        clickability_score: Math.min(95, Math.round((s.visual_score || 70) * 0.85 + Math.random() * 10)),
      }));

      pipelineStats.stages.clickability = {
        status: "failed",
        error: error.message,
        time_ms: Date.now() - stageStart,
      };
    }
  } else {
    // 跳过，添加默认点击欲分
    snips = snips.map((s) => ({ ...s, clickability_score: s.visual_score || 70 }));
    pipelineStats.stages.clickability = { status: "skipped" };
  }

  /*
  |----------------------------------------------------------------------
  | 计算综合评分并排序
  |----------------------------------------------------------------------
  */

  snips = snips.map((s) => ({
    ...s,
    overall_score: calculateOverallScore(s),
  }));

  // 按综合评分排序
  snips.sort((a, b) => b.overall_score - a.overall_score);

  console.log(`\n[排序] Top 3 Snips:`);
  snips.slice(0, 3).forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.label} (综合:${s.overall_score}, 视觉:${s.visual_score}, 点击欲:${s.clickability_score})`);
  });

  /*
  |----------------------------------------------------------------------
  | Stage 4: Content Understanding（内容理解）
  |----------------------------------------------------------------------
  */

  let contentUnderstanding = null;

  if (config.ENABLE_CONTENT_UNDERSTANDING) {
    console.log("\n[Stage 4] 内容理解...");
    const stageStart = Date.now();

    try {
      const frameDescriptions = snips.slice(0, 5).map((s) => ({
        timestamp: s.timestamp,
        label: s.label,
        reason: s.reason,
      }));

      contentUnderstanding = await understandContent(metadata, frameDescriptions);

      pipelineStats.stages.content_understanding = {
        status: "success",
        time_ms: Date.now() - stageStart,
      };

      console.log(`[Stage 4] 完成: 主题="${contentUnderstanding.core_theme}" (${Date.now() - stageStart}ms)`);
    } catch (error) {
      console.warn("[Stage 4] 内容理解失败:", error.message);
      pipelineStats.stages.content_understanding = {
        status: "failed",
        error: error.message,
        time_ms: Date.now() - stageStart,
      };
    }
  } else {
    pipelineStats.stages.content_understanding = { status: "skipped" };
  }

  /*
  |----------------------------------------------------------------------
  | Stage 5: Creative Strategy（创意策略）
  |----------------------------------------------------------------------
  */

  let strategies = { directions: [] };

  if (config.ENABLE_CREATIVE_STRATEGY) {
    console.log("\n[Stage 5] 创意策略生成...");
    const stageStart = Date.now();

    try {
      strategies = await generateStrategies(
        contentUnderstanding || { core_theme: "未知", content_tags: [] },
        snips,
        intent
      );

      pipelineStats.stages.creative_strategy = {
        status: "success",
        time_ms: Date.now() - stageStart,
        directions_count: strategies.directions.length,
      };

      console.log(`[Stage 5] 完成: 生成 ${strategies.directions.length} 个方向 (${Date.now() - stageStart}ms)`);
    } catch (error) {
      console.warn("[Stage 5] 创意策略生成失败:", error.message);
      pipelineStats.stages.creative_strategy = {
        status: "failed",
        error: error.message,
        time_ms: Date.now() - stageStart,
      };
    }
  } else {
    pipelineStats.stages.creative_strategy = { status: "skipped" };
  }

  /*
  |----------------------------------------------------------------------
  | 输出
  |----------------------------------------------------------------------
  */

  pipelineStats.total_time_ms = Date.now() - startTime;

  console.log("\n" + "=".repeat(60));
  console.log(`[Snips V3 Engine] 管线完成，总耗时 ${pipelineStats.total_time_ms}ms`);
  console.log(`[Snips V3 Engine] 输出: ${snips.length} Snips, ${strategies.directions.length} 方向`);
  console.log("=".repeat(60) + "\n");

  const result = {
    snips,
    directions: strategies.directions,
    contentUnderstanding,
    pipelineStats,
  };

  return normalizeOutput(result);
}

/*
|--------------------------------------------------------------------------
| 便捷方法：图片模式（兼容旧版API）
|--------------------------------------------------------------------------
*/

export async function analyzeImages(images, intent = "", metadata = {}) {
  return runV3Pipeline({
    images,
    intent,
    metadata: { ...metadata, type: "image" },
  });
}

/*
|--------------------------------------------------------------------------
| 便捷方法：视频帧模式
|--------------------------------------------------------------------------
*/

export async function analyzeFrames(frames, intent = "", metadata = {}) {
  return runV3Pipeline({
    frames,
    intent,
    metadata: { ...metadata, type: "video" },
  });
}

export default { runV3Pipeline, analyzeImages, analyzeFrames, CONFIG };
