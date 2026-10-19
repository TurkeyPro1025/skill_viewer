'use strict';

/**
 * HTTP API 层:网页 UI 与服务之间只通过这里的 JSON API 通信(为 Tauri sidecar 留门)。
 * 这也是全项目唯一的测试缝:黑盒测试只断言 API 响应与缓存产物。
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { parseFrontmatter } = require('./frontmatter');
const { parseBlocks } = require('./translate/blocks');
const { detectLanguage } = require('./util');
const { maskSecret } = require('./credentials');
const { testLlm, testTranslate } = require('./connectivity');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const UNKNOWN_GROUP = { key: '__unknown__', name: '未知来源' };

function createApp({ config, cache, analyzer, pipeline, seeds, credStore, providerSettings, presets }) {
  function currentIndex() {
    return cache.readIndex();
  }

  function getEntity(id) {
    return currentIndex()?.entities?.find((x) => x.id === id) || null;
  }

  function cardOf(e, pendingInference = {}) {
    const roots = [...new Map(e.appearances.map((ap) => [ap.rootLabel, ap])).values()];
    return {
      id: e.id,
      dirName: e.dirName,
      name: e.name,
      displayName: e.forked && e.versionLabel ? `${e.dirName} · ${e.versionLabel}` : e.dirName,
      description: e.description,
      summary: e.summary,
      summarySource: e.summarySource,
      categories: e.categories || [],
      roots: roots.map((r) => ({ label: r.rootLabel, linked: r.linked })),
      copyCount: 1 + (e.copies?.length || 0),
      forked: Boolean(e.forked),
      versionLabel: e.versionLabel || null,
      entryLanguage: e.entryLanguage,
      docCount: (e.docs || []).length,
      attribution: e.attribution ? {
        repo: e.attribution.repo,
        method: e.attribution.method,
        group: e.attribution.group || null,
        sourceUrl: e.attribution.sourceUrl || null,
        inferred: Boolean(e.attribution.inferred),
        confirmed: Boolean(e.attribution.confirmed),
        confidence: e.attribution.confidence || null,
        upstream: e.attribution.upstream || null,
        manual: Boolean(e.attribution.manual),
      } : null,
      // 中/低置信度推断不自动纳入分组,保留候选供"整理归属"中一键确认
      pendingInference: pendingInference[e.id] && !e.attribution?.confirmed
        ? { repo: pendingInference[e.id].repo, confidence: pendingInference[e.id].confidence }
        : null,
    };
  }

  /** 仓库→子技能 两级分组;无归属进"未知来源" */
  function groupedSkills(idx) {
    const pending = idx.lastInference || {};
    const groups = new Map();
    for (const e of idx.entities) {
      const repo = e.attribution?.repo || null;
      if (!repo) continue;
      if (!groups.has(repo)) {
        groups.set(repo, {
          key: repo,
          repo,
          name: repo,
          sourceUrl: e.attribution.sourceUrl || null,
          repoSummary: seeds?.sources?.[repo]?.repoSummary || '',
          subgroups: new Map(),
          count: 0,
        });
      }
      const g = groups.get(repo);
      g.count++;
      if (e.attribution.sourceUrl) g.sourceUrl ??= e.attribution.sourceUrl;
      const sgName = e.attribution.group || null;
      if (!g.subgroups.has(sgName)) g.subgroups.set(sgName, { name: sgName, skills: [] });
      g.subgroups.get(sgName).skills.push(cardOf(e, pending));
    }
    const unknown = idx.entities.filter((e) => !e.attribution?.repo).map((e) => cardOf(e, pending));
    const out = [...groups.values()]
      .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo))
      .map((g) => ({ ...g, subgroups: [...g.subgroups.values()].sort(subgroupOrder) }));
    if (unknown.length) {
      out.push({
        key: UNKNOWN_GROUP.key,
        repo: null,
        name: UNKNOWN_GROUP.name,
        sourceUrl: null,
        repoSummary: '未找到安装记录、git 远端或 frontmatter 来源的技能。可手动归组或配置 LLM 后推断。',
        subgroups: [{ name: null, skills: unknown }],
        count: unknown.length,
      });
    }
    return out;
  }

  function subgroupOrder(a, b) {
    if (a.name === null) return 1;
    if (b.name === null) return -1;
    return a.name.localeCompare(b.name);
  }

  function stateWithCredits() {
    const state = cache.readState();
    return {
      ...state,
      translateConfigured: pipeline ? pipeline.providerConfigured() : false,
      llmConfigured: Boolean(analyzer.llmConfigured?.()),
      pipelineCalls: pipeline?.stats.calls || 0,
      pipelineCredits: pipeline?.stats.credits || 0,
    };
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    // 跨源/DNS-rebinding 防护:状态变更请求必须来自本机同源。
    // (否则浏览器里任意网页都能向 127.0.0.1 发简单跨站 POST 写配置)
    if (req.method !== 'GET' && !isAuthorizedLocalRequest(req)) {
      return json(res, { error: { code: 'forbidden_origin', message: '拒绝跨源状态变更请求' } }, 403);
    }

    try {
      // ---- 静态资源 ----
      if (req.method === 'GET' && !p.startsWith('/api/')) {
        return serveStatic(p, res);
      }

      // ---- GET 端点 ----
      if (req.method === 'GET' && p === '/api/status') {
        return json(res, {
          phase: analyzer.getProgress(),
          running: analyzer.isRunning(),
          hasIndex: Boolean(currentIndex()),
          state: stateWithCredits(),
          config: {
            roots: (currentIndex()?.roots) || config.roots.map((r) => ({ path: r })),
            providers: {
              translate: { name: config.providers.translate.name, configured: pipeline ? pipeline.providerConfigured() : false },
              llm: { name: config.providers.llm.name, configured: Boolean(analyzer.llmConfigured?.()) },
            },
          },
        });
      }

      if (req.method === 'GET' && p === '/api/skills') {
        const idx = currentIndex();
        if (!idx) return json(res, { error: { code: 'no_index', message: '尚未完成首次分析' } }, 503);
        const pending = idx.lastInference || {};
        return json(res, {
          scannedAt: idx.scannedAt,
          trigger: idx.trigger,
          roots: idx.roots,
          stats: idx.stats,
          groups: groupedSkills(idx),
          skills: idx.entities.map((e) => cardOf(e, pending)),
          ignored: idx.ignored,
        });
      }

      if (req.method === 'GET' && p === '/api/categories') {
        const idx = currentIndex();
        const counts = new Map();
        for (const e of idx?.entities || []) {
          for (const c of e.categories || []) counts.set(c, (counts.get(c) || 0) + 1);
        }
        return json(res, { categories: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) });
      }

      const skillMatch = /^\/api\/skills\/([A-Za-z0-9_-]+)(?:\/(doc|file|translate|retry))?$/.exec(p);
      if (skillMatch) {
        const [, id, action] = skillMatch;
        const entity = getEntity(id);
        if (!entity) return json(res, { error: { code: 'not_found', message: '技能不存在' } }, 404);

        if (req.method === 'GET' && !action) {
          return json(res, skillDetail(entity, currentIndex()));
        }
        if (req.method === 'GET' && action === 'doc') {
          return json(res, readDoc(entity, url.searchParams.get('path') || 'SKILL.md'));
        }
        if (req.method === 'GET' && action === 'file') {
          return serveSkillFile(entity, url.searchParams.get('path') || '', res);
        }
        if (req.method === 'POST' && action === 'translate') {
          const body = await readBody(req);
          const state = cache.readState();
          try {
            const out = await withUsageTracking(() => pipeline.ensureTranslation(entity, body.path || 'SKILL.md', { consented: state.consentTranslate }));
            return json(res, out);
          } catch (err) {
            return translateError(err, res);
          }
        }
        if (req.method === 'POST' && action === 'retry') {
          const body = await readBody(req);
          const state = cache.readState();
          try {
            const out = await withUsageTracking(() => pipeline.retryFailed(entity, body.path || 'SKILL.md', { consented: state.consentTranslate }));
            return json(res, out);
          } catch (err) {
            return translateError(err, res);
          }
        }
      }

      // ---- POST 端点 ----
      if (req.method === 'POST' && p === '/api/consent') {
        const body = await readBody(req);
        const state = cache.readState();
        state.consentTranslate = Boolean(body.accept);
        cache.writeState(state);
        if (state.consentTranslate && !analyzer.isRunning()) {
          analyzer.run({ trigger: 'consent' }).catch(() => {});
        }
        return json(res, { ok: true, consentTranslate: state.consentTranslate });
      }

      if (req.method === 'POST' && p === '/api/clear-warnings') {
        const state = cache.readState();
        if (state.lastAnalysis) state.lastAnalysis.errors = [];
        cache.writeState(state);
        return json(res, { ok: true });
      }

      if (req.method === 'POST' && p === '/api/analyze') {
        if (analyzer.isRunning()) return json(res, { ok: true, started: false, running: true });
        analyzer.run({ trigger: 'manual' }).catch(() => {});
        return json(res, { ok: true, started: true });
      }

      if (req.method === 'POST' && p === '/api/overrides') {
        const body = await readBody(req);
        const { skillIds, repo } = body;
        if (!Array.isArray(skillIds) || !skillIds.length) {
          return json(res, { error: { code: 'bad_request', message: 'skillIds 必须为非空数组' } }, 400);
        }
        const data = cache.readOverrides();
        for (const id of skillIds) {
          data.entries[id] = { ...(data.entries[id] || {}), repo: typeof repo === 'string' && repo ? repo : '' };
          if (!repo) delete data.entries[id].confirmInference;
        }
        cache.writeOverrides(data);
        const idx = await analyzer.run({ trigger: 'overrides' });
        return json(res, { ok: true, affected: skillIds, groups: groupedSkills(idx) });
      }

      if (req.method === 'POST' && p === '/api/confirm-inference') {
        const body = await readBody(req);
        const { skillIds } = body;
        if (!Array.isArray(skillIds) || !skillIds.length) {
          return json(res, { error: { code: 'bad_request', message: 'skillIds 必须为非空数组' } }, 400);
        }
        const data = cache.readOverrides();
        for (const id of skillIds) {
          data.entries[id] = { ...(data.entries[id] || {}), confirmInference: true };
          delete data.entries[id].repo;
        }
        cache.writeOverrides(data);
        const idx = await analyzer.run({ trigger: 'confirm' });
        return json(res, { ok: true, affected: skillIds, groups: groupedSkills(idx) });
      }

      // ---- 设置(密钥加密存储 + LLM 预设) ----
      if (req.method === 'GET' && p === '/api/settings') {
        return json(res, settingsState());
      }

      if (req.method === 'POST' && p === '/api/settings/providers') {
        const body = await readBody(req);
        if (body.translate && 'apiKey' in body.translate) {
          const v = body.translate.apiKey;
          if (v === null) credStore.delete('uapipro');
          else if (typeof v === 'string' && v.trim()) credStore.set('uapipro', v.trim());
        }
        if (body.llm) {
          if (body.llm.apiKey === null) credStore.delete('llm');
          else if (typeof body.llm.apiKey === 'string' && body.llm.apiKey.trim()) credStore.set('llm', body.llm.apiKey.trim());
        const preset = presets.presets.find((x) => x.id === body.llm.preset);
        // 用户显式填写的地址优先(预设仅作默认值,如中转站换地址);否则回落预设地址
        const baseUrl = (typeof body.llm.baseUrl === 'string' && body.llm.baseUrl.trim())
          ? body.llm.baseUrl.trim()
          : (preset && preset.id !== 'custom' ? preset.baseUrl : undefined);
          providerSettings.updateLlm({
            ...(preset ? { preset: preset.id } : {}),
            ...(baseUrl !== undefined ? { baseUrl } : {}),
            ...(typeof body.llm.model === 'string' ? { model: body.llm.model.trim() } : {}),
          });
        }
        let analysisStarted = false;
        if (!analyzer.isRunning() && (pipeline.providerConfigured() || analyzer.llmConfigured())) {
          analyzer.run({ trigger: 'settings' }).catch(() => {});
          analysisStarted = true;
        }
        return json(res, { ok: true, analysisStarted, settings: settingsState() });
      }

      if (req.method === 'POST' && p === '/api/settings/test/llm') {
        const body = await readBody(req);
        const preset = presets.presets.find((x) => x.id === body.preset);
        const baseUrl = (typeof body.baseUrl === 'string' && body.baseUrl.trim())
          || preset?.baseUrl
          || providerSettings.get().llm.baseUrl
          || '';
        const apiKey = (typeof body.apiKey === 'string' && body.apiKey.trim())
          || credStore.get('llm')
          || '';
        const model = (typeof body.model === 'string' && body.model.trim())
          || providerSettings.get().llm.model
          || '';
        if (!baseUrl) return json(res, { error: { code: 'bad_request', message: '缺少 API 地址(选择预设或填写自定义地址)' } }, 400);
        return json(res, await testLlm({ baseUrl, apiKey, model }));
      }

      if (req.method === 'POST' && p === '/api/settings/test/translate') {
        const body = await readBody(req);
        const apiKey = (typeof body.apiKey === 'string' && body.apiKey.trim())
          || credStore.get('uapipro')
          || '';
        return json(res, await testTranslate({
          endpoint: config.providers.translate.endpoint,
          apiKey,
          full: Boolean(body.full),
          style: config.providers.translate.style,
          context: config.providers.translate.context,
        }));
      }

      return json(res, { error: { code: 'not_found', message: `未知路由 ${req.method} ${p}` } }, 404);
    } catch (err) {
      return translateError(err, res);
    }
  }

  /** 翻译调用后把本次增量(次数/积分)实时累计进 state,用户随时可见 */
  async function withUsageTracking(fn) {
    const before = { calls: pipeline.stats.calls, credits: pipeline.stats.credits };
    try {
      return await fn();
    } finally {
      const dCalls = pipeline.stats.calls - before.calls;
      const dCredits = pipeline.stats.credits - before.credits;
      if (dCalls > 0) {
        const state = cache.readState();
        state.apiCalls = (state.apiCalls || 0) + dCalls;
        state.creditsUsed = (state.creditsUsed || 0) + dCredits;
        cache.writeState(state);
      }
    }
  }

  /** GET /api/settings 的数据形状:只回掩码,绝不回传完整 key */
  function settingsState() {
    const storedT = credStore.get('uapipro');
    const storedL = credStore.get('llm');
    const llmSaved = providerSettings.get().llm;
    return {
      translate: {
        configured: pipeline.providerConfigured(),
        source: storedT ? 'store' : null,
        maskedKey: maskSecret(storedT),
      },
      llm: {
        configured: analyzer.llmConfigured(),
        source: storedL ? 'store' : null,
        maskedKey: maskSecret(storedL),
        preset: llmSaved.preset,
        baseUrl: llmSaved.baseUrl,
        model: llmSaved.model,
      },
      credentialStoreKind: credStore.kind,
      presets: presets.presets,
    };
  }

  /** 状态变更请求的本地同源校验(防跨站 POST / DNS rebinding) */
  function isAuthorizedLocalRequest(req) {
    const port = req.socket.localPort;
    const host = String(req.headers.host || '').toLowerCase().replace(/^\[|\]$/g, '');
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `::1:${port}`]);
    if (host && !allowed.has(host)) return false;
    const origin = req.headers.origin;
    if (origin) {
      try {
        const u = new URL(origin);
        if (!allowed.has(u.host.toLowerCase().replace(/^\[|\]$/g, ''))) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function translateError(err, res) {
    const code = err.code || 'internal';
    const status = code === 'consent_required' ? 409
      : code === 'provider_unconfigured' ? 503
        : code === 'doc_unreadable' || code === 'bad_path' ? 404
          : code === 'bad_request' ? 400 : 500;
    if (status === 500) console.error('[api]', err);
    return json(res, { error: { code, message: err.message } }, status);
  }

  function skillDetail(e, idx) {
    const skillMdRaw = safeRead(path.join(e.realPath, 'SKILL.md'));
    const { data: fm } = skillMdRaw === null ? { data: {} } : parseFrontmatter(skillMdRaw);
    return {
      ...cardOf(e),
      realPath: e.realPath,
      frontmatter: fm,
      docs: e.docs,
      images: e.images,
      copies: e.copies,
      contentHash: e.contentHash,
      lastInference: idx?.lastInference?.[e.id] || null,
    };
  }

  function readDoc(entity, relPath) {
    const safe = safeJoin(entity.realPath, relPath);
    if (!safe) {
      throw Object.assign(new Error(`非法路径: ${relPath}`), { code: 'bad_path' });
    }
    const raw = safeRead(safe);
    if (raw === null) {
      throw Object.assign(new Error(`文档不存在: ${relPath}`), { code: 'doc_unreadable' });
    }
    const { data: fm, body } = parseFrontmatter(raw);
    const blocks = parseBlocks(body);
    return {
      skillId: entity.id,
      path: relPath,
      language: detectLanguage(raw),
      frontmatter: Object.keys(fm).length ? fm : null,
      blocks: blocks.map((b) => ({ id: b.id, type: b.type, markdown: b.text })),
    };
  }

  function serveSkillFile(entity, relPath, res) {
    const safe = safeJoin(entity.realPath, relPath);
    if (!safe || !fs.existsSync(safe) || !fs.statSync(safe).isFile()) {
      return json(res, { error: { code: 'not_found', message: `文件不存在: ${relPath}` } }, 404);
    }
    const ext = path.extname(safe).toLowerCase();
    const body = fs.readFileSync(safe);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  }

  function serveStatic(p, res) {
    let rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const full = safeJoin(config.publicDir, rel);
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      // SPA 兜底:未知路径回首页
      rel = 'index.html';
    }
    const file = path.join(config.publicDir, rel);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  function safeJoin(base, rel) {
    if (typeof rel !== 'string' || rel.includes('\0')) return null;
    const full = path.resolve(base, rel);
    const normBase = path.resolve(base);
    if (full !== normBase && !full.startsWith(normBase + path.sep)) return null;
    return full;
  }

  function safeRead(file) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => translateError(err, res));
  });

  return { server, handle };
}

function json(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { code: 'bad_request' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

module.exports = { createApp };
