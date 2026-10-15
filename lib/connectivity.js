'use strict';

/**
 * 连通性探针(用用户当前输入或已存密钥,不要求先保存):
 * - LLM:先 GET /models(顺带拿模型列表),404/405 回退 1-token chat;
 * - 翻译(UApiPro):免费档 = 服务可达 + 空 text 请求(401=key 无效,400=鉴权通过),
 *   完整档 = 真实翻译 1 字符(消耗积分,结果确定)。
 */

const LLM_TIMEOUT = 12000;
const TRANSLATE_TIMEOUT = 15000;

async function testLlm({ baseUrl, apiKey, model }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, error: '缺少 API 地址' };
  const t0 = Date.now();
  const headers = { Authorization: `Bearer ${apiKey || ''}` };

  // 1) models 列表(多数 OpenAI 兼容服务免费提供)
  try {
    const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(LLM_TIMEOUT) });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const models = Array.isArray(body?.data)
        ? body.data.map((m) => m?.id).filter((id) => typeof id === 'string')
        : [];
      return { ok: true, latencyMs: Date.now() - t0, models };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, latencyMs: Date.now() - t0, error: `鉴权失败(HTTP ${res.status}):key 无效或无权限` };
    }
    // 404/405 → 该服务不提供 /models,走 chat 探测
  } catch (err) {
    return { ok: false, error: `无法连接:${err.message}` };
  }

  // 2) 1-token chat 兜底
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT),
    });
    if (res.ok) return { ok: true, latencyMs: Date.now() - t0, models: [] };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, latencyMs: Date.now() - t0, error: `鉴权失败(HTTP ${res.status}):key 无效或无权限` };
    }
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    return { ok: false, latencyMs: Date.now() - t0, error: `服务返回 HTTP ${res.status}:${detail}` };
  } catch (err) {
    return { ok: false, error: `无法连接:${err.message}` };
  }
}

async function testTranslate({ endpoint, apiKey, full = false, style = 'professional', context = 'technical' }) {
  const out = { reachable: false, keyAccepted: null, full: null };
  let origin;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    out.error = `endpoint 配置不合法: ${endpoint}`;
    return out;
  }

  // 免费可达性探针:平台 usage 统计端点(无需鉴权)
  try {
    const r = await fetch(`${origin}/api/v1/status/usage`, { signal: AbortSignal.timeout(8000) });
    out.reachable = r.ok;
  } catch (err) {
    out.error = `服务不可达:${err.message}`;
    return out;
  }
  if (!out.reachable) {
    out.error = '服务可达性探针未通过';
    return out;
  }
  if (!apiKey) {
    out.error = '未提供 API key';
    return out;
  }

  const url = new URL(endpoint);
  url.searchParams.set('target_lang', 'zh');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

  if (full) {
    // 真实翻译 1 字符:确定但计费
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: 'hi', style, context, preserve_format: true }),
        signal: AbortSignal.timeout(TRANSLATE_TIMEOUT),
      });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        const sample = body?.data?.translated_text;
        out.full = { ok: true, sample: typeof sample === 'string' ? sample.slice(0, 80) : '' };
        out.keyAccepted = true;
      } else if (res.status === 401 || res.status === 403) {
        out.keyAccepted = false;
        out.full = { ok: false, error: `key 无效(HTTP ${res.status})` };
      } else {
        out.full = { ok: false, error: `HTTP ${res.status}:${(await res.text().catch(() => '')).slice(0, 200)}` };
        out.keyAccepted = res.status !== 401;
      }
    } catch (err) {
      out.full = { ok: false, error: err.message };
    }
    return out;
  }

  // 免费档:空 text 请求。鉴权通常先于参数校验 → 401=key 无效,400=已过鉴权
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: '', style, context, preserve_format: true }),
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT),
    });
    if (res.status === 401 || res.status === 403) out.keyAccepted = false;
    else out.keyAccepted = true;
  } catch (err) {
    out.error = `探测请求失败:${err.message}`;
  }
  return out;
}

module.exports = { testLlm, testTranslate };
