#!/usr/bin/env node
'use strict';

/**
 * 静态文案批量翻译产线(v1.1.0 一次性工具,服务于官网与文档英文化)。
 *
 * 输入/输出都是扁平 JSON: { "key": "文案" } -> { "key": "English draft" }。
 * - 代码块、行内代码、URL、HTML 标签、{{占位符}} 先替换成 __PH_n__ 令牌,
 *   译后回填,保证命令/链接/路径不被改写;
 * - 多条文案用 <<<SEG>>> 分隔合并成一次调用(≤ 9000 字符),失败或分隔符
 *   数量不符时自动降级为逐条翻译;
 * - 密钥只从 UAPI_KEY 环境变量读取,不写入任何文件,也不接受命令行明文;
 *
 * 用法:
 *   UAPI_KEY=... node scripts/translate-copy.js .scratch/copy-deck.zh.json .scratch/copy-deck.en.json
 *   node scripts/translate-copy.js in.json out.json --target en --style professional --context technical
 */

const fs = require('node:fs');
const path = require('node:path');

const ENDPOINT = 'https://uapis.cn/api/v1/ai/translate';
const SEP = '\n\n<<<SEG>>>\n\n';
const MAX_CHARS = 9000;
const QPS = 4;
const RETRIES = 3;

function parseArgs(argv) {
  const args = { input: '', output: '', target: 'en', style: 'professional', context: 'technical' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target' || a === '--style' || a === '--context') {
      args[a.slice(2)] = argv[++i] || '';
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      rest.push(a);
    }
  }
  args.input = rest[0] || '';
  args.output = rest[1] || '';
  return args;
}

function protect(text) {
  const tokens = [];
  const keep = (s) => {
    tokens.push(s);
    return `__PH_${tokens.length - 1}__`;
  };
  const out = text
    .replace(/```[\s\S]*?```/g, keep)
    .replace(/`[^`\n]+`/g, keep)
    .replace(/https?:\/\/[^\s)<>"']+/g, keep)
    .replace(/<\/?[a-zA-Z][^>]*>/g, keep)
    .replace(/\{\{[^}]+\}\}/g, keep)
    .replace(/\[\[[^\]]+\]\]/g, keep);
  return { text: out, tokens };
}

function restore(text, tokens) {
  return text.replace(/__PH_(\d+)__/g, (m, i) => {
    const token = tokens[Number(i)];
    return token === undefined ? m : token;
  });
}

function missingTokens(text, tokens) {
  const missing = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!text.includes(`__PH_${i}__`)) missing.push(i);
  }
  return missing;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTranslate({ text, key, target, style, context }) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('target_lang', target);
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, style, context, preserve_format: true }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    const err = new Error(`翻译服务返回 ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  const translated = body && body.data && body.data.translated_text;
  if (typeof translated !== 'string') throw new Error('响应缺少 data.translated_text');
  return translated;
}

async function translateWithRetry(opts) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await callTranslate(opts);
    } catch (err) {
      lastErr = err;
      const retriable = !err.status || err.status === 429 || err.status >= 500;
      if (!retriable || attempt === RETRIES) break;
      await sleep(attempt * 1500);
    }
  }
  throw lastErr;
}

function buildBatches(entries) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const entry of entries) {
    const cost = entry.text.length + SEP.length;
    if (current.length && size + cost > MAX_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function translateBatch(batch, opts) {
  if (batch.length === 1) {
    const text = await translateWithRetry({ ...opts, text: batch[0].text });
    return [text];
  }
  const joined = batch.map((e) => e.text).join(SEP);
  const translated = await translateWithRetry({ ...opts, text: joined });
  const parts = translated.split(SEP);
  if (parts.length !== batch.length) {
    // 分隔符被模型改写:降级为逐条,保证结果可对齐
    const out = [];
    for (const entry of batch) {
      out.push(await translateWithRetry({ ...opts, text: entry.text }));
      await sleep(1000 / QPS);
    }
    return out;
  }
  return parts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input || !args.output) {
    console.log('用法: UAPI_KEY=... node scripts/translate-copy.js <in.json> <out.json> [--target en] [--style professional] [--context technical]');
    process.exit(args.help ? 0 : 1);
  }
  const key = process.env.UAPI_KEY || '';
  if (!key) {
    console.error('缺少密钥:请设置 UAPI_KEY 环境变量');
    process.exit(1);
  }

  const source = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
  const entries = [];
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string') throw new Error(`词条 ${name} 不是字符串`);
    if (value.length > MAX_CHARS) throw new Error(`词条 ${name} 超过单次上限(${value.length})`);
    const { text, tokens } = protect(value);
    entries.push({ name, text, tokens });
  }

  const batches = buildBatches(entries);
  console.log(`词条 ${entries.length} 条,分 ${batches.length} 批,目标语言 ${args.target}`);

  const output = {};
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[${i + 1}/${batches.length}] ${batch.map((e) => e.name).join(', ')}`);
    const parts = await translateBatch(batch, {
      key,
      target: args.target,
      style: args.style,
      context: args.context,
    });
    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j];
      const missing = missingTokens(parts[j], entry.tokens);
      if (missing.length) {
        throw new Error(`词条 ${entry.name} 的受保护片段丢失: ${missing.join(',')}`);
      }
      output[entry.name] = restore(parts[j], entry.tokens);
    }
    if (i < batches.length - 1) await sleep(1000 / QPS);
  }

  fs.writeFileSync(path.resolve(args.output), JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`完成: ${args.output}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
