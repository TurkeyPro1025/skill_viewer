'use strict';

/**
 * 归属引擎(瀑布式,只读):
 *   overrides(手动,最高) → lock 安装清单 → .git remote → frontmatter URL(创作上游)
 *   → LLM 读正文推断(标注"推断",待确认)→ 未知来源
 *
 * 两个可扩展注册表(开源卖点):
 *   - manifestReaders:   识别新的安装清单格式(如其他 CLI 的 lock 文件)
 *   - sourceRecognizers: 新的归属信息来源
 * 详见 CONTRIBUTING.md。
 */

function createEngine({ manifestReaders = [], sourceRecognizers = [], llmProvider = null, overrides = {} } = {}) {
  const readers = [...manifestReaders];
  const recognizers = [];

  function registerManifestReader(reader) {
    readers.push(reader);
  }

  function registerSourceRecognizer(recognizer) {
    recognizers.push(recognizer);
    recognizers.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
  }

  /** 读取一个清单文件,用注册的 reader 解析为规范条目 {folder → {repo, sourceUrl, group, ...}} */
  function readManifest(file) {
    let raw;
    try {
      raw = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    for (const reader of readers) {
      try {
        if (reader.canRead(raw)) return { format: reader.name, entries: reader.parse(raw) };
      } catch {
        // 单个 reader 解析失败不影响其余
      }
    }
    return null;
  }

  /**
   * 对单个技能实体跑归属瀑布。
   * @returns {Promise<object>} attribution
   */
  async function resolve(entity, ctx = {}) {
    const upstream = ctx.upstreams?.get(entity.dirName) ?? null;
    let result = null;

    for (const r of recognizers) {
      try {
        result = await r.recognize(entity, ctx);
      } catch {
        result = null;
      }
      if (result) break;
    }

    let attribution;
    if (result) {
      attribution = { ...result, upstream: upstream || result.upstream || null };
    } else {
      attribution = {
        repo: null, method: null, sourceUrl: null, group: null,
        inferred: false, confidence: null, confirmed: false, upstream,
      };
    }
    // overrides 最高优先级:手动归组/确认推断
    const o = overrides[entity.id];
    if (o) {
      if (typeof o.repo === 'string') {
        attribution = {
          ...attribution,
          repo: o.repo || null,
          method: 'overrides',
          manual: true,
          inferred: false,
          sourceUrl: o.repo ? attribution.sourceUrl : null,
        };
        if (!o.repo) attribution.unknown = true;
      } else if (o.confirmInference && ctx.lastInference?.[entity.id] && (!result?.method || result.method === 'llm')) {
        // 确认推断:只覆盖"无归属"或"推断"层级,不覆盖 lock/git 等更强来源
        attribution = { ...ctx.lastInference[entity.id], confirmed: true };
      }
    }
    return attribution;
  }

  const engine = {
    registerManifestReader,
    registerSourceRecognizer,
    readManifest,
    resolve,
    get recognizers() {
      return recognizers.map((r) => r.name);
    },
    get manifestReaders() {
      return readers.map((r) => r.name);
    },
  };
  engine.llmProvider = llmProvider;
  return engine;
}

module.exports = { createEngine };
