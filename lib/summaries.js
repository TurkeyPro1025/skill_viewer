'use strict';

/**
 * 概述解析(读路径 + 翻译源):
 * - 中文界面:种子 → 中文缓存 → (分析阶段 LLM) → 原文描述。
 * - 非中文界面:card-summary = frontmatter 描述(英文直接使用,其它语言翻译);
 *   分类标签与仓库简介来自中文种子/中文概述缓存,翻译后写入该语言缓存。
 * 读路径不发起任何外部调用;缺失时先原文直出,等分析补齐。
 */

const { sha1 } = require('./util');

// 概述策略版本:非中文界面 = 描述 + 翻译元数据。旧索引(无此字段或低于 2)需重跑一次。
const SUMMARY_META_VERSION = 2;

function seedFor(entity, attribution, seeds) {
  const sources = seeds?.sources || {};
  const byRepo = attribution?.repo ? sources[attribution.repo] : null;
  return byRepo?.skills?.[entity.dirName] || sources['*']?.skills?.[entity.dirName] || null;
}

/** 分类的来源:种子优先,其次中文 LLM 概述缓存 */
function sourceCategories({ entity, attribution, seeds, cache }) {
  const seed = seedFor(entity, attribution, seeds);
  if (seed?.categories?.length) return seed.categories;
  const cached = cache.readSkill(entity.id, 'zh');
  if (cached && cached.contentHash === entity.contentHash && Array.isArray(cached.categories)) {
    return cached.categories;
  }
  return [];
}

/** 非中文界面的翻译源:描述 + 中文分类标签 */
function localizedSource({ entity, attribution, seeds, cache }) {
  return {
    description: String(entity.description || ''),
    categories: sourceCategories({ entity, attribution, seeds, cache }),
  };
}

/** 源文本哈希:描述或分类变化时使该语言的概述缓存失效 */
function summarySourceHash(source) {
  return sha1(JSON.stringify({ description: source.description, categories: source.categories }));
}

function isValidLocalizedCache(cached, entity, lang, source) {
  return Boolean(cached
    && cached.lang === lang
    && cached.contentHash === entity.contentHash
    && cached.summarySource === 'description'
    && cached.sourceHash === summarySourceHash(source)
    && typeof cached.summary === 'string');
}

function resolveStoredSummary({ entity, attribution, lang, seeds, cache }) {
  if (lang === 'zh') {
    const seed = seedFor(entity, attribution, seeds);
    if (seed?.summary) {
      return { summary: seed.summary, summarySource: 'seed', categories: seed.categories || [] };
    }
    const cached = cache.readSkill(entity.id, 'zh');
    if (cached && cached.contentHash === entity.contentHash && cached.summary) {
      return { summary: cached.summary, summarySource: cached.summarySource || 'llm', categories: cached.categories || [] };
    }
    return null;
  }

  const source = localizedSource({ entity, attribution, seeds, cache });
  const cached = cache.readSkill(entity.id, lang);
  if (isValidLocalizedCache(cached, entity, lang, source)) {
    return { summary: cached.summary, summarySource: 'description', categories: cached.categories || [] };
  }
  // 尚未翻译:先原文直出;分类留空,等分析补齐翻译缓存
  return {
    summary: source.description || '(no description)',
    summarySource: 'description',
    categories: [],
  };
}

function fallbackSummary(entity, lang) {
  return {
    summary: entity.description || (lang === 'zh' ? '(无描述)' : '(no description)'),
    summarySource: lang === 'zh' ? 'fallback' : 'description',
    categories: [],
  };
}

/** 仓库简介:中文用种子原文;其它语言用翻译缓存(按源文本哈希校验) */
function resolveRepoSummary(repo, lang, seeds, cache) {
  const source = seeds?.sources?.[repo]?.repoSummary || '';
  if (!source) return '';
  if (lang === 'zh') return source;
  const entry = cache.readRepoSummaries(lang)?.entries?.[repo];
  if (entry && entry.sourceHash === sha1(source) && entry.summary) return entry.summary;
  return '';
}

module.exports = {
  SUMMARY_META_VERSION,
  localizedSource,
  summarySourceHash,
  isValidLocalizedCache,
  resolveStoredSummary,
  fallbackSummary,
  resolveRepoSummary,
};
