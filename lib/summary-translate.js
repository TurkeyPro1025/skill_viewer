'use strict';

/**
 * 非中文界面的元数据翻译(分析写路径):
 * - card-summary = frontmatter 描述:英文直接使用,中文等其它语言译成目标语言;
 * - chips(分类标签)与 group-summary(仓库简介)从中文种子/中文概述缓存翻译为目标语言;
 * - 结果分别写入 skills/{id}/{lang}.json、summaries/labels/{lang}.json、summaries/repos/{lang}.json。
 * 内容未变时按源文本哈希命中缓存,不再调用翻译服务。
 */

const { sha1, detectLanguage } = require('./util');
const {
  localizedSource,
  summarySourceHash,
  isValidLocalizedCache,
} = require('./summaries');

function needsTranslation(text, lang) {
  if (!text || !text.trim()) return false;
  if (lang === 'en') return detectLanguage(text) === 'zh';
  // 未来语言:非英文文本都译;英文文本直接使用
  return detectLanguage(text) !== 'en';
}

async function localizeSummaries({ entities, attributions, lang, seeds, cache, pipeline, consented }) {
  if (lang === 'zh' || !pipeline || !consented || !pipeline.providerConfigured()) return null;

  const rows = entities.map((entity) => {
    const source = localizedSource({ entity, attribution: attributions[entity.id], seeds, cache });
    const cached = cache.readSkill(entity.id, lang);
    return { entity, source, cached, valid: isValidLocalizedCache(cached, entity, lang, source) };
  });

  const labelMap = cache.readLabelMap(lang);
  const repoData = cache.readRepoSummaries(lang);
  const repoEntries = { ...(repoData.entries || {}) };

  const requests = [];
  const requestIndex = new Map(); // key → requests 下标
  const addRequest = (key, text) => {
    if (requestIndex.has(key)) return requestIndex.get(key);
    const i = requests.length;
    requests.push(text);
    requestIndex.set(key, i);
    return i;
  };

  const descIndex = new Map();
  const catIndex = new Map();
  const repoIndex = new Map();

  for (const row of rows) {
    if (row.valid) continue;
    if (needsTranslation(row.source.description, lang)) {
      descIndex.set(row.entity.id, addRequest(`d:${row.entity.id}`, row.source.description));
    }
    for (const cat of row.source.categories) {
      if (!needsTranslation(cat, lang) || labelMap[cat]) continue;
      catIndex.set(cat, addRequest(`c:${cat}`, cat));
    }
  }

  const repos = [...new Set(entities.map((e) => attributions[e.id]?.repo).filter(Boolean))];
  let repoEntriesChanged = false;
  for (const repo of repos) {
    const source = seeds?.sources?.[repo]?.repoSummary || '';
    if (!source) continue;
    const existing = repoEntries[repo];
    if (existing && existing.sourceHash === sha1(source) && existing.summary) continue;
    if (needsTranslation(source, lang)) {
      repoIndex.set(repo, addRequest(`r:${repo}`, source));
    } else {
      repoEntries[repo] = { summary: source, sourceHash: sha1(source) };
      repoEntriesChanged = true;
    }
  }

  let translations = [];
  if (requests.length) {
    try {
      translations = await pipeline.translateTexts(requests, { lang });
    } catch {
      translations = requests.map(() => null);
    }
  }
  const failed = translations.reduce((n, t) => n + (t ? 0 : 1), 0);

  const cards = new Map();
  let written = 0;
  for (const row of rows) {
    if (row.valid) {
      cards.set(row.entity.id, {
        summary: row.cached.summary,
        summarySource: 'description',
        categories: row.cached.categories || [],
      });
      continue;
    }

    const descAt = descIndex.get(row.entity.id);
    const translatedDesc = descAt === undefined ? row.source.description : translations[descAt];
    // 描述翻译失败:不写缓存(下次分析重试),由调用方回退原文
    if (descAt !== undefined && !translatedDesc) continue;

    const categories = [];
    let incomplete = false;
    for (const cat of row.source.categories) {
      if (!needsTranslation(cat, lang)) {
        categories.push(cat);
        continue;
      }
      const translated = labelMap[cat] || (catIndex.has(cat) ? translations[catIndex.get(cat)] : null);
      if (translated) {
        categories.push(translated);
        labelMap[cat] = translated;
      } else {
        incomplete = true;
      }
    }
    // 分类翻译有缺失:不写缓存,下次分析重试(避免永久丢掉部分 chips)
    if (incomplete) continue;

    const summary = translatedDesc || (lang === 'zh' ? '(无描述)' : '(no description)');
    cache.writeSkill(row.entity.id, lang, {
      id: row.entity.id,
      lang,
      contentHash: row.entity.contentHash,
      sourceHash: summarySourceHash(row.source),
      summary,
      summarySource: 'description',
      categories,
      createdAt: new Date().toISOString(),
    });
    written++;
    cards.set(row.entity.id, { summary, summarySource: 'description', categories });
  }

  for (const [repo, i] of repoIndex) {
    if (translations[i]) {
      const source = seeds?.sources?.[repo]?.repoSummary || '';
      repoEntries[repo] = { summary: translations[i], sourceHash: sha1(source) };
      repoEntriesChanged = true;
    }
  }
  if (repoEntriesChanged) cache.writeRepoSummaries(lang, { entries: repoEntries });
  if (Object.keys(labelMap).length) cache.writeLabelMap(lang, labelMap);

  return { cards, written, failed };
}

module.exports = { localizeSummaries };
