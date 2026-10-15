'use strict';

/**
 * OpenAI 兼容 LLM 适配器(目标 DeepSeek / GLM 等)。
 * baseUrl / apiKey / model 全部来自注入的网页设置(加密存储 + providers.json)。
 * 未配置时 configured()=false,调用方优雅降级,绝不报错阻塞。
 */

function createLlmProvider(cfg, deps = {}) {
  const {
    baseUrlDefault = '',
    modelDefault = '',
    timeoutMs = 120000,
  } = cfg || {};
  // 配置只来自注入的 providerSettings/加密存储(网页设置页),不读环境变量
  const getBaseUrl = deps.getBaseUrl || (() => baseUrlDefault || '');
  const getApiKey = deps.getApiKey || (() => '');
  const getModel = deps.getModel || (() => modelDefault || '');

  const stats = { calls: 0, failures: 0 };

  function baseUrl() {
    return String(getBaseUrl() || '').replace(/\/+$/, '');
  }

  function apiKey() {
    return getApiKey() || '';
  }

  function model() {
    return getModel() || '';
  }

  function configured() {
    return Boolean(baseUrl() && apiKey() && model());
  }

  /**
   * 基础对话。返回 assistant 消息文本。
   * @param {Array<{role:string,content:string}>} messages
   */
  async function chat(messages) {
    if (!configured()) {
      throw Object.assign(new Error('LLM provider 未配置'), { code: 'provider_unconfigured' });
    }
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({ model: model(), messages, temperature: 0.3 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    stats.calls++;
    if (!res.ok) {
      stats.failures++;
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM 服务返回 ${res.status}: ${detail.slice(0, 300)}`);
    }
    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('LLM 响应缺少 choices[0].message.content');
    return content;
  }

  /** 期望 JSON 回复的对话:提取并解析第一个 JSON 对象 */
  async function chatJson(messages) {
    const raw = await chat(messages);
    return extractJson(raw);
  }

  return { name: 'openai-compat', configured, chat, chatJson, stats };
}

function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch { /* 尝试下一个 */ }
  }
  return null;
}

module.exports = { createLlmProvider, extractJson };
