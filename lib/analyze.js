'use strict';

/**
 * 分析编排:扫描 → 归属(瀑布) → 概述(种子→LLM→降级) → 入口文档预翻译。
 * 触发时机:启动时与手动更新;其余时间纯读缓存零 API 调用。
 * 增量:概述与译文都以内容哈希为键,内容未变的技能直接沿用缓存。
 */

const fs = require('node:fs');
const path = require('node:path');
const { scan } = require('./scanner');
const { createEngine } = require('./attribution/engine');
const lockReader = require('./attribution/recognizers/lock-reader');
const {
  createLockRecognizer,
  createGitRecognizer,
  createFrontmatterUrlRecognizer,
  createLlmRecognizer,
  findSourceUrl,
  repoFromUrl,
} = require('./attribution/recognizers/sources');
const { buildSummaryMessages, parseSummary, buildInferenceMessages, parseInference } = require('./llm/tasks');
const { detectLanguage, readJsonIfExists } = require('./util');

function createAnalyzer({ config, cache, pipeline, llmProvider, seeds = {} }) {
  const progress = { phase: 'idle', done: 0, total: 0, detail: '', startedAt: null, errors: [] };
  let running = null;

  function buildEngine(overrides) {
    const engine = createEngine({ overrides });
    engine.registerManifestReader(lockReader);
    engine.registerSourceRecognizer(createLockRecognizer({
      manifestFiles: () => config.lockFiles,
    }));
    engine.registerSourceRecognizer(createGitRecognizer());
    engine.registerSourceRecognizer(createFrontmatterUrlRecognizer());
    engine.registerSourceRecognizer(createLlmRecognizer());
    return engine;
  }

  /** 当前是否正在分析(防止并发重入) */
  function isRunning() {
    return Boolean(running);
  }

  function getProgress() {
    return { ...progress };
  }

  async function run({ trigger = 'manual' } = {}) {
    if (running) return running;
    running = (async () => analyze(trigger))();
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  async function analyze(trigger) {
    progress.phase = 'scan';
    progress.done = 0;
    progress.total = 0;
    progress.detail = '扫描技能根目录…';
    progress.startedAt = new Date().toISOString();
    progress.errors = [];
    const usage0 = pipeline ? { calls: pipeline.stats.calls, credits: pipeline.stats.credits } : null;

    const overrides = cache.readOverrides().entries;
    const engine = buildEngine(overrides);

    // 清单:先用注册的 reader 解析所有 lock 文件
    const manifests = {};
    for (const file of config.lockFiles) {
      const m = engine.readManifest(file);
      if (m) manifests[file] = m;
      else progress.errors.push(`清单未识别或不可读: ${file}`);
    }
    const lockEntries = Object.values(manifests).flatMap((m) => Object.values(m.entries));
    const knownRepos = [...new Set(lockEntries.map((e) => e.repo).filter(Boolean))];

    const scanResult = scan({ roots: config.roots });

    // 每个实体附正文预览(LLM 概述/推断输入)
    progress.phase = 'attribute';
    progress.total = scanResult.entities.length;
    const entities = scanResult.entities.map((e) => enrichEntity(e));

    const upstreams = new Map();
    for (const e of entities) {
      const url = findSourceUrl(e.frontmatter || {});
      if (url) upstreams.set(e.dirName, { url, repo: repoFromUrl(url) });
    }

    // LLM 推断(标注"推断",存 lastInference 供确认);上一轮推断结果内容未变则复用,不重复调用。
    // 先跑一遍不含推断的瀑布,确定哪些技能需要推断。
    const baseCtx = { manifests, knownRepos, upstreams, lastInference: {} };
    const lastInference = {};
    const prevIndex = cache.readIndex();
    const prevEntities = new Map((prevIndex?.entities || []).map((e) => [e.id, e]));
    const prevInference = prevIndex?.lastInference || {};
    if (llmProvider?.configured()) {
      for (const e of entities) {
        const o = overrides[e.id];
        if (o && typeof o.repo === 'string') continue; // 手动已归组
        const base = await engine.resolve(e, baseCtx);
        if (base.repo) continue;
        // 上一轮推断结果(含"推断不出"的负结果)内容未变则复用,不重复调用
        if (prevInference[e.id] !== undefined && prevEntities.get(e.id)?.contentHash === e.contentHash) {
          lastInference[e.id] = prevInference[e.id];
          continue;
        }
        try {
          progress.detail = `LLM 推断归属:${e.name}`;
          const obj = await llmProvider.chatJson(buildInferenceMessages(e, knownRepos));
          const parsed = parseInference(obj);
          if (parsed) {
            lastInference[e.id] = {
              repo: parsed.repo,
              sourceUrl: null,
              group: null,
              method: 'llm',
              inferred: true,
              confidence: parsed.confidence,
              alternatives: parsed.alternatives,
              confirmed: false,
              upstream: base.upstream,
            };
          } else {
            lastInference[e.id] = null; // 负结果也缓存:内容未变不再烧 LLM 调用
          }
        } catch (err) {
          progress.errors.push(`LLM 推断失败(${e.name}): ${String(err.message || err).slice(0, 120)}`);
        }
      }
    }

    // 最终遍:带推断结果与 overrides 走完整瀑布,得到最终归属
    const ctx = { manifests, knownRepos, upstreams, lastInference };
    const attributions = {};
    for (const [i, e] of entities.entries()) {
      progress.done = i + 1;
      progress.detail = `归属:${e.name}`;
      attributions[e.id] = await engine.resolve(e, ctx);
    }

    // 概述:种子 → 缓存(内容未变) → LLM → 降级 frontmatter 描述
    progress.phase = 'summaries';
    progress.done = 0;
    const cards = {};
    for (const [i, e] of entities.entries()) {
      progress.done = i + 1;
      progress.detail = `概述:${e.name}`;
      const a = attributions[e.id];
      cards[e.id] = await resolveCard(e, a);
    }

    // 组装索引
    const index = {
      version: 1,
      scannedAt: scanResult.scannedAt,
      trigger,
      roots: config.roots.map((r) => ({ path: r, label: labelOfRoot(r) })),
      lockFiles: config.lockFiles,
      entities: entities.map((e) => ({
        id: e.id,
        realPath: e.realPath,
        dirName: e.dirName,
        name: e.name,
        description: e.description,
        entryLanguage: e.entryLanguage,
        contentHash: e.contentHash,
        docs: e.docs,
        images: e.images,
        forked: Boolean(e.forked),
        versionLabel: e.versionLabel || null,
        appearances: e.appearances.map((ap) => ({ rootLabel: ap.rootLabel, linked: ap.linked })),
        copies: (e.copies || []).map((c) => ({
          realPath: c.realPath,
          appearances: c.appearances.map((ap) => ({ rootLabel: ap.rootLabel, linked: ap.linked })),
        })),
        attribution: attributions[e.id],
        summary: cards[e.id].summary,
        summarySource: cards[e.id].summarySource,
        categories: cards[e.id].categories,
      })),
      ignored: scanResult.ignored,
      lastInference,
      stats: {
        entities: entities.length,
        attributed: Object.values(attributions).filter((a) => a.repo).length,
        inferred: Object.values(attributions).filter((a) => a.inferred && !a.confirmed).length,
        linkedMerged: entities.reduce((n, e) => n + Math.max(0, e.appearances.length - 1), 0),
      },
    };
    cache.writeIndex(index);

    // 入口文档预翻译:只在用户显式点「手动更新」时执行(知情、按需烧积分)。
    // 启动/同意隐私/保存设置都不预翻——尤其避免重启后对全部英文技能
    // 一次性批量计费,以及与用户当前打开文档抢 4QPS 节流队列。
    const state = cache.readState();
    if (state.consentTranslate && trigger === 'manual' && pipeline && pipelineProviderConfigured(pipeline)) {
      progress.phase = 'pretranslate';
      const english = entities.filter((e) => e.entryLanguage !== 'zh');
      progress.total = english.length;
      progress.done = 0;
      for (const e of english) {
        progress.done++;
        progress.detail = `预翻译:${e.name}`;
        try {
          await pipeline.ensureTranslation(e, 'SKILL.md', { consented: true });
        } catch (err) {
          if (err.code !== 'provider_unconfigured') {
            progress.errors.push(`预翻译失败(${e.name}): ${String(err.message || err).slice(0, 120)}`);
          }
        }
      }
    }

    progress.phase = 'done';
    progress.detail = `完成:${index.stats.entities} 个技能,归属 ${index.stats.attributed} 个`;

    // 累计积分/调用数写入状态(增量:与 API 层 withUsageTracking 各计各的,不重复)
    const nextState = cache.readState();
    nextState.lastAnalysis = {
      at: new Date().toISOString(),
      trigger,
      entities: index.stats.entities,
      errors: progress.errors.slice(0, 20),
    };
    if (pipeline && usage0) {
      const dCalls = pipeline.stats.calls - usage0.calls;
      const dCredits = pipeline.stats.credits - usage0.credits;
      if (dCalls > 0) {
        nextState.apiCalls = (nextState.apiCalls || 0) + dCalls;
        nextState.creditsUsed = (nextState.creditsUsed || 0) + dCredits;
      }
    }
    cache.writeState(nextState);
    return index;
  }

  function pipelineProviderConfigured(p) {
    try {
      return p.providerConfigured();
    } catch {
      return false;
    }
  }

  function enrichEntity(e) {
    let bodyPreview = '';
    try {
      const skillMd = path.join(e.realPath, 'SKILL.md');
      const raw = fs.readFileSync(skillMd, 'utf8');
      const fmEnd = raw.indexOf('---', 3);
      bodyPreview = fmEnd > 0 ? raw.slice(raw.indexOf('\n', fmEnd) + 1) : raw;
    } catch { /* 忽略 */ }
    return { ...e, bodyPreview: bodyPreview.slice(0, 4000) };
  }

  /** 概述解析:种子 → 缓存 → LLM → 降级描述 */
  async function resolveCard(e, attribution) {
    // 1. 种子(按 repo+dirName,或全局 dirName)
    const seedSources = seeds?.sources || {};
    const byRepo = attribution?.repo ? seedSources[attribution.repo] : null;
    const seed = byRepo?.skills?.[e.dirName] || seedSources['*']?.skills?.[e.dirName] || null;
    if (seed?.summary) {
      return { summary: seed.summary, summarySource: 'seed', categories: seed.categories || [] };
    }
    // 2. 缓存:内容未变沿用
    const cached = cache.readSkill(e.id);
    if (cached && cached.contentHash === e.contentHash && cached.summary) {
      return { summary: cached.summary, summarySource: cached.summarySource || 'llm', categories: cached.categories || [] };
    }
    // 3. LLM 生成
    if (llmProvider?.configured()) {
      try {
        const obj = await llmProvider.chatJson(buildSummaryMessages(e));
        const parsed = parseSummary(obj);
        if (parsed) {
          cache.writeSkill(e.id, {
            id: e.id,
            contentHash: e.contentHash,
            summary: parsed.summary,
            summarySource: 'llm',
            categories: parsed.categories,
            createdAt: new Date().toISOString(),
          });
          return { summary: parsed.summary, summarySource: 'llm', categories: parsed.categories };
        }
      } catch (err) {
        progress.errors.push(`LLM 概述失败(${e.name}): ${String(err.message || err).slice(0, 120)}`);
      }
    }
    // 4. 降级:frontmatter 原文描述
    return { summary: e.description || '(无描述)', summarySource: 'fallback', categories: cached?.categories || [] };
  }

  function labelOfRoot(root) {
    const parts = path.resolve(root).split(/[\\/]/).filter(Boolean);
    const idx = parts.lastIndexOf('skills');
    return idx > 0 ? parts[idx - 1] : parts[parts.length - 1] || root;
  }

  return { run, isRunning, getProgress, llmConfigured: () => Boolean(llmProvider?.configured()) };
}

module.exports = { createAnalyzer };
