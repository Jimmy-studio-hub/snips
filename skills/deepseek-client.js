/*
|--------------------------------------------------------------------------
| Snips V3 Engine - DeepSeek API Client (原生 fetch 实现)
|--------------------------------------------------------------------------
| 使用原生 fetch 调用 DeepSeek API，避免依赖 openai 包
| 兼容 OpenAI API 格式
|--------------------------------------------------------------------------
*/

const BASE_URL = "https://api.deepseek.com";

function getApiKey() {
  return process.env.DEEPSEEK_API_KEY || process.env.deepseek_flash || "";
}

/**
 * 调用 DeepSeek Chat Completions API
 * @param {Object} options - 请求选项
 * @param {string} options.model - 模型名称
 * @param {Array} options.messages - 消息数组
 * @param {number} options.temperature - 温度
 * @param {number} options.max_tokens - 最大token数
 * @param {number} options.timeout - 超时时间(毫秒)
 * @returns {Promise<Object>} API响应
 */
export async function createChatCompletion(options) {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("DeepSeek API key not configured. Set DEEPSEEK_API_KEY or deepseek_flash environment variable.");
  }

  const controller = new AbortController();
  const timeout = options.timeout || 60000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.max_tokens ?? 2000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`DeepSeek API request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * 从API响应中提取文本内容
 * @param {Object} response - API响应
 * @returns {string} 文本内容
 */
export function extractContent(response) {
  return response?.choices?.[0]?.message?.content || "";
}
