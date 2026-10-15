'use strict';

/**
 * 翻译管线:块级解析 → 行内保护 → 分块打包单次调用(积分友好)→ 拆回按 ID 关联 → 缓存。
 * 缓存键 = 技能真实路径哈希 + 文档内容哈希;内容未变永不重复调用。
 * 失败块逐块记录错误,可重试;打包调用失败自动降级为逐块调用尽量挽回。
 */

const fs = require('node:fs');
const path = require('node:path');
const { sha1, shortHash, writeJsonAtomic, readJsonIfExists, detectLanguage } = require('../util');
const { parseFrontmatter } = require('../frontmatter');
const { parseBlocks, protectInline, restoreInline } = require('./blocks');

const CACHE_VERSION = 1;
const CHUNK_MARGIN = 100; // 分块余量:仅覆盖 ⟦S n⟧/⟦E⟧ 分隔符(约 12 字符/块),尽量贴满单次字符上限

function createPipeline({ provider, cacheDir, onProgress }) {
  const stats = { calls: 0, credits: 0 };
  // 同一文档的并发翻译请求共享同一个进行中的 Promise:
  // 避免"查看器请求 + 后台预翻"并发时对同一文档翻译两遍(双倍积分)。
  const inflight = new Map();

  function translationsDir(skillId) {
    return path.join(cacheDir, 'translations', skillId);
  }

  function cacheFile(skillId, docHash) {
    return path.join(translationsDir(skillId), `${docHash}.json`);
  }

  /** 读缓存;docHash 不匹配(内容已变)即视为 miss */
  function readCache(skillId, docRelPath, docHash) {
    const hit = readJsonIfExists(cacheFile(skillId, docHash));
    if (hit && hit.version === CACHE_VERSION && hit.docHash === docHash) return hit;
    return null;
  }

  function writeCache(entry) {
    writeJsonAtomic(cacheFile(entry.skillId, entry.docHash), entry);
  }

  /**
   * 确保某文档有译文:缓存命中直接返回,否则翻译并写缓存。
   * 首次翻译前必须已获用户同意(consent 由 API 层校验后传入)。
   */
  async function ensureTranslation(entity, docRelPath, { consented } = {}) {
    const docPath = path.join(entity.realPath, docRelPath);
    let raw;
    try {
      raw = fs.readFileSync(docPath, 'utf8');
    } catch (err) {
      throw Object.assign(new Error(`文档不可读: ${docRelPath}`), { code: 'doc_unreadable', cause: err });
    }
    const docHash = sha1(raw);
    if (detectLanguage(raw) === 'zh') {
      return { language: 'zh', cached: true, blocks: null, reason: '中文原文不翻译' };
    }

    const cached = readCache(entity.id, docRelPath, docHash);
    if (cached) return { ...cached, cached: true };

    if (!provider.configured()) {
      throw Object.assign(new Error('翻译 provider 未配置(API key 缺失)'), { code: 'provider_unconfigured' });
    }
    if (!consented) {
      throw Object.assign(new Error('需要用户同意隐私提示后才能翻译'), { code: 'consent_required' });
    }

    const inflightKey = `${entity.id}\0${docHash}`;
    const existing = inflight.get(inflightKey);
    if (existing) return existing;

    const p = translateDoc(entity, docRelPath, raw, docHash)
      .then((r) => ({ ...r, cached: false }))
      .finally(() => inflight.delete(inflightKey));
    inflight.set(inflightKey, p);
    return p;
  }

  async function translateDoc(entity, docRelPath, raw, docHash) {
    // frontmatter 摘出不译(spec:frontmatter 与代码块占位摘出、译后回填)
    const { body } = parseFrontmatter(raw);
    const blocks = parseBlocks(body);
    const translatable = blocks.filter((b) => b.translatable);
    const result = {
      version: CACHE_VERSION,
      skillId: entity.id,
      realPath: entity.realPath,
      docRelPath,
      docHash,
      provider: provider.name,
      createdAt: new Date().toISOString(),
      blocks: blocks.map((b) => ({ id: b.id, type: b.type, src: b.text, translated: '', status: b.translatable ? 'pending' : 'original' })),
      calls: 0,
      credits: 0,
    };
    const byId = new Map(result.blocks.map((b) => [b.id, b]));

    const chunks = packChunks(translatable, provider.maxCharsPerCall - CHUNK_MARGIN);
    let done = 0;
    for (const chunk of chunks) {
      onProgress?.({ doc: docRelPath, done, total: translatable.length });
      await translateChunk(chunk, byId, result);
      done += chunk.length;
    }
    onProgress?.({ doc: docRelPath, done: translatable.length, total: translatable.length });
    writeCache(result);
    return result;
  }

  async function translateChunk(chunkBlocks, byId, result) {
    // 打包:多个块拼一段用 ⟦S n⟧ 分隔,一次调用省积分
    const masked = chunkBlocks.map((b) => {
      const { masked: m, map } = protectInline(b.text);
      return { block: b, masked: m, map };
    });
    const joined = masked.map((x, i) => `⟦S${i}⟧\n${x.masked}`).join('\n⟦E⟧\n');

    try {
      const out = await callProvider(joined, result);
      const parts = splitBySeparators(out, masked.length);
      if (!parts) throw new Error('分隔符丢失,降级逐块');
      masked.forEach((x, i) => {
        applyResult(byId, x, parts[i]);
      });
      return;
    } catch (err) {
      // 打包失败 → 逐块降级,尽量部分成功
    }

    for (const x of masked) {
      try {
        const out = await callProvider(x.masked, result);
        applyResult(byId, x, out);
      } catch (err) {
        const b = byId.get(x.block.id);
        b.status = 'failed';
        b.error = String(err.message || err).slice(0, 300);
      }
    }
  }

  async function callProvider(text, result) {
    try {
      const { text: translated, credits } = await provider.translateText(text);
      result.calls++;
      result.credits += credits;
      stats.calls++;
      stats.credits += credits;
      return translated;
    } catch (err) {
      throw err;
    }
  }

  function applyResult(byId, x, translatedMasked) {
    const b = byId.get(x.block.id);
    try {
      b.translated = restoreInline(translatedMasked, x.map);
      b.status = 'ok';
      b.error = null;
    } catch (err) {
      b.status = 'failed';
      b.error = String(err.message || err);
    }
  }

  /** 拆回译文:必须精确得到 n 段,否则返回 null */
  function splitBySeparators(text, n) {
    // ⟦S0⟧ ... ⟦E⟧ ⟦S1⟧ ... ⟦E⟧ ⟦S2⟧ ...
    const parts = [];
    let rest = text;
    for (let i = 0; i < n; i++) {
      const startRe = new RegExp(`^\\s*⟦S${i}⟧\\s*\\n?`);
      const m = startRe.exec(rest);
      if (!m) return null;
      rest = rest.slice(m[0].length);
      const endIdx = rest.indexOf('⟦E⟧');
      if (i < n - 1) {
        if (endIdx === -1) return null;
        parts.push(rest.slice(0, endIdx));
        rest = rest.slice(endIdx + 3);
      } else {
        parts.push(endIdx === -1 ? rest : rest.slice(0, endIdx));
      }
    }
    return parts;
  }

  function packChunks(blocks, maxChars) {
    const chunks = [];
    let cur = [];
    let curLen = 0;
    const overhead = (n) => n * 12 + 20;
    for (const b of blocks) {
      const add = b.text.length + 12;
      if (cur.length && curLen + add + overhead(cur.length + 1) > maxChars) {
        chunks.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(b);
      curLen += add;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  /** 重试失败块:只重译 status=failed 的块,合并进缓存 */
  async function retryFailed(entity, docRelPath, { consented } = {}) {
    if (!provider.configured()) {
      throw Object.assign(new Error('翻译 provider 未配置'), { code: 'provider_unconfigured' });
    }
    if (!consented) {
      throw Object.assign(new Error('需要用户同意隐私提示后才能翻译'), { code: 'consent_required' });
    }
    const raw = fs.readFileSync(path.join(entity.realPath, docRelPath), 'utf8');
    const docHash = sha1(raw);
    const cached = readCache(entity.id, docRelPath, docHash);
    if (!cached) return ensureTranslation(entity, docRelPath, { consented });

    const failed = cached.blocks.filter((b) => b.status === 'failed');
    if (!failed.length) return { ...cached, cached: true, retried: 0 };

    const byId = new Map(cached.blocks.map((b) => [b.id, b]));
    const pseudoBlocks = failed.map((b) => ({ id: b.id, text: b.src, translatable: true, type: b.type }));
    await translateChunk(pseudoBlocks, byId, cached);
    writeCache(cached);
    return { ...cached, cached: true, retried: failed.length };
  }

  return {
    ensureTranslation,
    retryFailed,
    readCache,
    stats,
    providerConfigured: () => provider.configured(),
  };
}

module.exports = { createPipeline };
