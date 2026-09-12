/*
|--------------------------------------------------------------------------
| Snips V3 Engine - Frame Selection Skill
|--------------------------------------------------------------------------
| 程序预筛选：过滤黑屏、模糊、过曝、欠曝、重复画面
| 输入：候选帧数组 [{ dataUrl, timestamp, index }]
| 输出：筛选后的帧数组 + 筛选统计
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| 配置
|--------------------------------------------------------------------------
*/

const CONFIG = {
  // 黑屏阈值：平均亮度低于此值视为黑屏
  BLACK_THRESHOLD: 15,

  // 过曝阈值：平均亮度高于此值视为过曝
  OVEREXPOSED_THRESHOLD: 240,

  // 模糊阈值：拉普拉斯方差低于此值视为模糊
  BLUR_THRESHOLD: 100,

  // 重复帧相似度阈值：像素差异低于此值视为重复
  DUPLICATE_THRESHOLD: 5,

  // 最小候选帧数
  MIN_CANDIDATES: 5,

  // 最大候选帧数
  MAX_CANDIDATES: 20,

  // 色彩丰富度阈值：低于此值视为色彩单调
  COLOR_DIVERSITY_THRESHOLD: 20,
};

/*
|--------------------------------------------------------------------------
| 工具函数
|--------------------------------------------------------------------------
*/

/**
 * 从 dataUrl 解析出 ImageData（使用纯JS，不依赖canvas）
 * 注意：在Node.js环境中，我们使用sharp来处理图像
 */
async function loadImageData(dataUrl) {
  try {
    // 动态导入sharp
    const sharp = (await import("sharp")).default;

    // 从base64提取buffer
    const base64 = dataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    // 缩小到合理尺寸以加快处理
    const { data, info } = await sharp(buffer)
      .resize(320, 180, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    console.warn("[FrameSelection] sharp加载失败，使用降级方案:", error.message);
    return null;
  }
}

/**
 * 计算平均亮度
 */
function calculateBrightness(imageData) {
  const { data, width, height } = imageData;
  let sum = 0;
  const pixelCount = width * height;

  for (let i = 0; i < data.length; i += 4) {
    // ITU-R BT.601 亮度公式
    const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += brightness;
  }

  return sum / pixelCount;
}

/**
 * 计算拉普拉斯方差（模糊检测）
 */
function calculateBlurScore(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);

  // 转灰度
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // 拉普拉斯算子
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian =
        4 * gray[idx] -
        gray[idx - 1] -
        gray[idx + 1] -
        gray[idx - width] -
        gray[idx + width];

      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;

  return variance;
}

/**
 * 计算两帧之间的像素差异（用于重复帧检测）
 */
function calculateFrameDifference(frameA, frameB) {
  const dataA = frameA.data;
  const dataB = frameB.data;
  const length = Math.min(dataA.length, dataB.length);

  let sumDiff = 0;
  for (let i = 0; i < length; i += 4) {
    const diff =
      Math.abs(dataA[i] - dataB[i]) +
      Math.abs(dataA[i + 1] - dataB[i + 1]) +
      Math.abs(dataA[i + 2] - dataB[i + 2]);
    sumDiff += diff / 3;
  }

  return sumDiff / (length / 4);
}

/**
 * 计算色彩丰富度（标准差分）
 */
function calculateColorDiversity(imageData) {
  const { data, width, height } = imageData;
  let rSum = 0, gSum = 0, bSum = 0;
  const pixelCount = width * height;

  for (let i = 0; i < data.length; i += 4) {
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
  }

  const rMean = rSum / pixelCount;
  const gMean = gSum / pixelCount;
  const bMean = bSum / pixelCount;

  let rVar = 0, gVar = 0, bVar = 0;
  for (let i = 0; i < data.length; i += 4) {
    rVar += Math.pow(data[i] - rMean, 2);
    gVar += Math.pow(data[i + 1] - gMean, 2);
    bVar += Math.pow(data[i + 2] - bMean, 2);
  }

  return Math.sqrt((rVar + gVar + bVar) / (3 * pixelCount));
}

/*
|--------------------------------------------------------------------------
| 主筛选函数
|--------------------------------------------------------------------------
*/

/**
 * 帧筛选主函数
 * @param {Array} frames - 候选帧数组 [{ dataUrl, timestamp, index }]
 * @param {Object} options - 配置覆盖
 * @returns {Object} { candidates: [], stats: {}, rejected: [] }
 */
export async function selectFrames(frames, options = {}) {
  const config = { ...CONFIG, ...options };

  const stats = {
    total: frames.length,
    black: 0,
    overexposed: 0,
    blurry: 0,
    duplicate: 0,
    lowColor: 0,
    candidates: 0,
    rejected: [],
  };

  const candidates = [];
  const processedFrames = [];

  console.log(`[FrameSelection] 开始筛选 ${frames.length} 帧...`);

  // 第一阶段：单帧质量检测
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const imageData = await loadImageData(frame.dataUrl);

    if (!imageData) {
      // 加载失败，保留但标记
      candidates.push({ ...frame, quality: "unknown", scores: {} });
      continue;
    }

    const brightness = calculateBrightness(imageData);
    const blurScore = calculateBlurScore(imageData);
    const colorDiversity = calculateColorDiversity(imageData);

    const frameInfo = {
      ...frame,
      imageData,
      scores: {
        brightness,
        blurScore,
        colorDiversity,
      },
    };

    // 黑屏检测
    if (brightness < config.BLACK_THRESHOLD) {
      stats.black++;
      stats.rejected.push({ index: frame.index, timestamp: frame.timestamp, reason: "black" });
      continue;
    }

    // 过曝检测
    if (brightness > config.OVEREXPOSED_THRESHOLD) {
      stats.overexposed++;
      stats.rejected.push({ index: frame.index, timestamp: frame.timestamp, reason: "overexposed" });
      continue;
    }

    // 模糊检测
    if (blurScore < config.BLUR_THRESHOLD) {
      stats.blurry++;
      stats.rejected.push({ index: frame.index, timestamp: frame.timestamp, reason: "blurry" });
      continue;
    }

    // 色彩单调检测
    if (colorDiversity < config.COLOR_DIVERSITY_THRESHOLD) {
      stats.lowColor++;
      stats.rejected.push({ index: frame.index, timestamp: frame.timestamp, reason: "low_color" });
      continue;
    }

    processedFrames.push(frameInfo);
  }

  // 第二阶段：重复帧检测（与前一帧比较）
  const nonDuplicate = [];
  for (let i = 0; i < processedFrames.length; i++) {
    if (i === 0) {
      nonDuplicate.push(processedFrames[i]);
      continue;
    }

    const diff = calculateFrameDifference(
      processedFrames[i - 1].imageData,
      processedFrames[i].imageData
    );

    if (diff < config.DUPLICATE_THRESHOLD) {
      stats.duplicate++;
      stats.rejected.push({
        index: processedFrames[i].index,
        timestamp: processedFrames[i].timestamp,
        reason: "duplicate",
      });
      continue;
    }

    nonDuplicate.push(processedFrames[i]);
  }

  // 第三阶段：如果候选帧过多，按质量评分排序取前N个
  let finalCandidates = nonDuplicate;

  if (nonDuplicate.length > config.MAX_CANDIDATES) {
    // 综合质量评分：模糊度（越高越清晰）+ 色彩丰富度 + 亮度适中度
    finalCandidates = nonDuplicate
      .map((frame) => {
        const brightnessScore = 100 - Math.abs(frame.scores.brightness - 128) * 0.5;
        const qualityScore =
          Math.min(frame.scores.blurScore / 10, 100) * 0.4 +
          Math.min(frame.scores.colorDiversity * 2, 100) * 0.3 +
          brightnessScore * 0.3;
        return { ...frame, qualityScore };
      })
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, config.MAX_CANDIDATES)
      .sort((a, b) => a.index - b.index); // 恢复时间顺序
  }

  // 清理imageData，只保留需要的字段
  candidates = finalCandidates.map(({ imageData, ...rest }) => ({
    ...rest,
    quality: "selected",
  }));

  stats.candidates = candidates.length;

  console.log(`[FrameSelection] 筛选完成: ${stats.total} → ${stats.candidates} 候选帧`);
  console.log(`[FrameSelection] 统计: 黑屏=${stats.black}, 过曝=${stats.overexposed}, 模糊=${stats.blurry}, 重复=${stats.duplicate}, 色彩单调=${stats.lowColor}`);

  return {
    candidates,
    stats,
  };
}

/**
 * 同步版本（用于前端，使用canvas）
 * 注意：此函数仅在浏览器环境中使用
 */
export function selectFramesSync(frames, options = {}) {
  const config = { ...CONFIG, ...options };
  // 前端实现占位，实际使用canvas API
  return { candidates: frames.slice(0, config.MAX_CANDIDATES), stats: { total: frames.length } };
}

export default { selectFrames, selectFramesSync, CONFIG };
