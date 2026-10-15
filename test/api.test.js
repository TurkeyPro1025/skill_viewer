'use strict';

/**
 * 黑盒测试:唯一测试缝 = 本地服务的 HTTP API(spec 测试决策)。
 * fixture 技能树 + stub provider,不打真网、不需要真实 key。
 * 覆盖票 01-12 的验收标准;UI 手动验收清单见 README。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildFixtures, createFakeUApiPro, createFakeLlm } = require('./helpers');
const { loadConfig } = require('../lib/config');
const { createCache } = require('../lib/cache');
const { createCredentialStore } = require('../lib/credentials');
const { createProviderSettings } = require('../lib/providerSettings');
const { createTranslateProvider } = require('../lib/translate/uapipro');
const { createPipeline } = require('../lib/translate/pipeline');
const { createLlmProvider } = require('../lib/llm/provider');
const { createAnalyzer } = require('../lib/analyze');
const { createApp } = require('../lib/api');
const { createEngine } = require('../lib/attribution/engine');
const lockReader = require('../lib/attribution/recognizers/lock-reader');
const presets = require('../lib/llm/presets.json');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-viewer-test-'));
const FIXTURES = path.join(TMP, 'fixtures');
const DATA = path.join(TMP, 'data');

const ctx = {};

/* ---------- 基建 ---------- */

async function startApp({ dataDir = DATA, llmEnv = true, translateEnv = true } = {}) {
  const llmPort = ctx.llmPort;
  const cfg = loadConfig(path.join(TMP, 'config.json'));
  cfg.dataDir = dataDir;
  cfg.port = 0;

  const cache = createCache({ dataDir });
  cache.ensureDirs();
  const credStore = await createCredentialStore({ dataDir }).init();
  const providerSettings = createProviderSettings({ dataDir });
  // 无环境变量概念:配置一律走加密存储 + providers.json(与网页设置页同链路)
  if (translateEnv) credStore.set('uapipro', 'stub-key');
  if (llmEnv) {
    credStore.set('llm', 'stub-llm-key');
    providerSettings.updateLlm({ preset: 'custom', baseUrl: `http://127.0.0.1:${llmPort}/v1`, model: 'stub-model' });
  }
  const translateProvider = createTranslateProvider(cfg.providers.translate, {
    keyGetter: () => credStore.get('uapipro') || '',
  });
  const pipeline = createPipeline({ provider: translateProvider, cacheDir: dataDir });
  const llmProvider = createLlmProvider(cfg.providers.llm, {
    getBaseUrl: () => providerSettings.get().llm.baseUrl || '',
    getApiKey: () => credStore.get('llm') || '',
    getModel: () => providerSettings.get().llm.model || '',
  });
  const seeds = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'seeds.json'), 'utf8'));
  const analyzer = createAnalyzer({ config: cfg, cache, pipeline, llmProvider, seeds });
  const { server } = createApp({ config: cfg, cache, analyzer, pipeline, seeds, credStore, providerSettings, presets });
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return { server, port, base: `http://127.0.0.1:${port}`, translateProvider, llmProvider };
}

/** 关服:先掐 keep-alive 连接,close() 才不会被闲置连接卡住 */
function closeServer(server) {
  server.closeAllConnections?.();
  server.closeIdleConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

async function get(base, p) {
  const res = await fetch(base + p);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

async function post(base, p, payload) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function waitFor(fn, timeoutMs = 30000, everyMs = 100) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

async function runAnalysis(base) {
  await post(base, '/api/analyze');
  await waitFor(async () => {
    const st = await get(base, '/api/status');
    return !st.body.running && st.body.phase?.phase === 'done';
  });
}

function skillsByDir(data, dir) {
  return data.skills.filter((s) => s.dirName === dir);
}

/* ---------- 生命周期 ---------- */

test.before(async () => {
  const fx = buildFixtures(FIXTURES);
  ctx.uapi = createFakeUApiPro();
  ctx.llm = createFakeLlm();
  ctx.uapiPort = await ctx.uapi.listen();
  ctx.llmPort = await ctx.llm.listen();

  fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({
    port: 0,
    roots: fx.roots,
    lockFiles: [fx.lock],
    dataDir: DATA,
    seedsFile: path.join(FIXTURES, 'seeds.json'),
    providers: {
      translate: {
        endpoint: `http://127.0.0.1:${ctx.uapiPort}/api/v1/ai/translate`,
      },
    },
  }, null, 2));

  const app = await startApp();
  Object.assign(ctx, app);
});

test.after(async () => {
  if (ctx.server) await closeServer(ctx.server);
  await closeServer(ctx.uapi.server);
  await closeServer(ctx.llm.server);
  fs.rmSync(TMP, { recursive: true, force: true });
});

/* ---------- 01 骨架与平铺列表 ---------- */

test('01 首次分析:frontmatter 解析、平铺列表、缓存索引', async () => {
  const before = await get(ctx.base, '/api/skills');
  assert.equal(before.status, 503, '首次分析前应返回 no_index');
  assert.equal(before.body.error.code, 'no_index');

  await runAnalysis(ctx.base);

  const { body: data } = await get(ctx.base, '/api/skills');
  assert.equal(data.stats.entities, 7, `实体数应为 7(去重后),实际 ${data.stats.entities}`);

  const alphas = skillsByDir(data, 'alpha');
  assert.equal(alphas.length, 1, 'junction/拷贝合并后 alpha 只有一条');
  assert.equal(alphas[0].name, 'alpha');
  assert.match(alphas[0].description, /Alpha skill for testing/);

  const detail = await get(ctx.base, `/api/skills/${alphas[0].id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.docs.some((d) => d.rel === 'SKILL.md'));
  assert.ok(detail.body.docs.some((d) => d.rel === 'reference-long.md'));

  const ignoredNames = data.ignored.map((i) => i.name);
  assert.ok(ignoredNames.includes('no-skill'), '缺 SKILL.md 的文件夹应记入 ignored');
  assert.ok(ignoredNames.includes('nested'), '嵌套子目录不视为技能');

  assert.ok(fs.existsSync(path.join(DATA, 'index.json')), '分析结果持久化为 JSON');
});

test('01 二次启动直接读缓存,不重新扫描也能显示', async () => {
  const app2 = await startApp({ dataDir: path.join(TMP, 'data-cacheboot') });
  // 直接把主 dataDir 的 index 拷过去,模拟"已有缓存的新进程"
  fs.copyFileSync(path.join(DATA, 'index.json'), path.join(TMP, 'data-cacheboot', 'index.json'));
  const res = await get(app2.base, '/api/skills');
  assert.equal(res.status, 200);
  assert.equal(res.body.stats.entities, 7);
  await closeServer(app2.server);
});

/* ---------- 02 多根与去重 ---------- */

test('02 多根扫描:junction/symlink 去重、链接徽章、拷贝合并、版本分岔', async () => {
  const { body: data } = await get(ctx.base, '/api/skills');
  const alpha = skillsByDir(data, 'alpha')[0];
  const labels = alpha.roots.map((r) => r.label);
  assert.deepEqual([...new Set(labels)].sort(), ['agents', 'claudeA', 'zcodeA'], 'alpha 应出现在三个根');
  assert.ok(alpha.roots.find((r) => r.label === 'agents' && !r.linked), 'agents 为实体根');
  assert.ok(alpha.roots.find((r) => r.label === 'zcodeA' && r.linked), 'zcodeA 为链接');
  assert.ok(alpha.copyCount >= 2, '内容一致的 alpha-copy 独立拷贝应合并');

  const betas = skillsByDir(data, 'beta');
  assert.equal(betas.length, 2, '同名但内容分岔的 beta 应有两个版本');
  assert.ok(betas.every((b) => b.forked), '两个 beta 均标 forked');
  assert.ok(betas.some((b) => b.versionLabel === 'agents') && betas.some((b) => b.versionLabel === 'claudeA'));

  assert.ok(data.stats.linkedMerged >= 2, '链接去重计数');
});

/* ---------- 03 lock 主表归属 ---------- */

test('03 lock 主表:仓库→子技能两级结构、仓库内分组、未归属不降级', async () => {
  const { body: data } = await get(ctx.base, '/api/skills');
  const mono = data.groups.find((g) => g.repo === 'example/mono');
  assert.ok(mono, 'example/mono 组存在');
  assert.equal(mono.sourceUrl, 'https://github.com/example/mono.git');
  const sub = mono.subgroups.find((s) => s.name === 'sub');
  assert.ok(sub, 'lock 的仓库内路径分组(sub)进入结构');
  assert.ok(sub.skills.some((s) => s.dirName === 'alpha'));
  assert.equal(sub.skills[0].attribution.method, 'lock');
  assert.equal(sub.skills[0].attribution.repo, 'example/mono');

  const cn = data.groups.find((g) => g.repo === 'example/cn');
  assert.ok(cn?.subgroups.some((s) => s.skills.some((x) => x.dirName === 'chinese-one')));

  const unknown = data.groups.find((g) => g.key === '__unknown__');
  assert.ok(unknown, '未归属技能进入未知来源组');
  const unknownDirs = unknown.subgroups.flatMap((s) => s.skills.map((x) => x.dirName));
  assert.ok(unknownDirs.includes('lonely'), 'lonely 在未知来源');
  assert.ok(unknownDirs.includes('beta'), 'beta 分岔副本(claudeA,无 .git)在未知来源');
});

test('03z 扩展点:注册新清单格式识别器不改核心(结构性检查)', () => {
  const engine = createEngine({});
  engine.registerManifestReader(lockReader);
  engine.registerManifestReader({
    name: 'custom-lock',
    canRead: (raw) => raw && raw.format === 'custom',
    parse: (raw) => ({ [raw.skill]: { repo: raw.origin } }),
  });

  const customFile = path.join(TMP, 'custom-lock.json');
  fs.writeFileSync(customFile, JSON.stringify({ format: 'custom', skill: 'kappa', origin: 'custom/mono' }));
  const m = engine.readManifest(customFile);
  assert.equal(m.format, 'custom-lock');
  assert.equal(m.entries.kappa.repo, 'custom/mono');

  const lockFile = path.join(FIXTURES, 'lock.json');
  assert.equal(engine.readManifest(lockFile).format, 'skill-lock-v3');
});

/* ---------- 04 归属瀑布补充链 ---------- */

test('04 瀑布优先级:lock > .git > frontmatter URL,创作上游标注', async () => {
  const { body: data } = await get(ctx.base, '/api/skills');
  const alpha = skillsByDir(data, 'alpha')[0];
  assert.equal(alpha.attribution.method, 'lock', '有 lock 条目时优先 lock(alpha 的 .git 是诱饵)');

  const betaAgents = skillsByDir(data, 'beta').find((b) => b.versionLabel === 'agents');
  assert.equal(betaAgents.attribution.method, 'git');
  assert.equal(betaAgents.attribution.repo, 'hand/hand-repo');
  assert.equal(betaAgents.attribution.sourceUrl, 'https://github.com/hand/hand-repo.git');

  const gamma = skillsByDir(data, 'gamma')[0];
  assert.equal(gamma.attribution.method, 'frontmatter-url');
  assert.equal(gamma.attribution.repo, 'up/upstream-repo');
  assert.equal(gamma.attribution.upstream.repo, 'up/upstream-repo', 'frontmatter URL 同时作为创作上游标注');
});

/* ---------- 05 种子概述与分类 ---------- */

test('05 种子概述:两仓库生效、分类独立、无种子降级', async () => {
  const { body: data } = await get(ctx.base, '/api/skills');
  const alpha = skillsByDir(data, 'alpha')[0];
  assert.equal(alpha.summarySource, 'seed');
  assert.equal(alpha.summary, '种子概述:alpha 是测试技能。');
  assert.deepEqual(alpha.categories, ['种子分类A', '设计'], '分类标签独立于仓库归组');

  const cnOne = skillsByDir(data, 'chinese-one')[0];
  assert.equal(cnOne.summarySource, 'seed');

  const mono = data.groups.find((g) => g.repo === 'example/mono');
  assert.match(mono.repoSummary, /示例单仓库/);

  const cats = await get(ctx.base, '/api/categories');
  assert.ok(cats.body.categories.some((c) => c.name === '种子分类A' && c.count === 1));
});

/* ---------- 06 搜索维度(过滤为纯前端,API 提供全部维度) ---------- */

test('06 搜索字段齐全:名称/描述/概述/分类/仓库均可检索', async () => {
  const { body: data } = await get(ctx.base, '/api/skills');
  const alpha = skillsByDir(data, 'alpha')[0];
  for (const field of ['name', 'dirName', 'description', 'summary', 'categories']) {
    assert.ok(field in alpha, `卡片应携带 ${field} 供前端过滤`);
  }
  assert.ok(data.groups.every((g) => typeof g.repo === 'string' || g.key === '__unknown__'));
});

/* ---------- 07 文档查看器·原文 ---------- */

test('07 文档端点:块解析、图片、中文判定、路径安全', async () => {
  const alpha = skillsByDir((await get(ctx.base, '/api/skills')).body, 'alpha')[0];
  const doc = await get(ctx.base, `/api/skills/${alpha.id}/doc?path=SKILL.md`);
  assert.equal(doc.status, 200);
  assert.equal(doc.body.language, 'en');
  const types = doc.body.blocks.map((b) => b.type);
  for (const t of ['heading', 'paragraph', 'list', 'code', 'table']) {
    assert.ok(types.includes(t), `块类型应包含 ${t}`);
  }
  assert.ok(doc.body.blocks.find((b) => b.type === 'code').markdown.includes('code block never translated'));

  const zh = skillsByDir((await get(ctx.base, '/api/skills')).body, 'chinese-one')[0];
  const zhDoc = await get(ctx.base, `/api/skills/${zh.id}/doc?path=SKILL.md`);
  assert.equal(zhDoc.body.language, 'zh', '中文文档应判定为 zh(单栏直出)');

  const img = await get(ctx.base, `/api/skills/${alpha.id}/file?path=assets/pic.png`);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/png/);

  const evil = await get(ctx.base, `/api/skills/${alpha.id}/file?path=../lock.json`);
  assert.notEqual(evil.status, 200, '路径穿越应被拒绝');

  const missing = await get(ctx.base, `/api/skills/${alpha.id}/doc?path=nope.md`);
  assert.equal(missing.status, 404);
});

/* ---------- 08 翻译管线与对照 ---------- */

test('08 隐私门:未同意前翻译被拒(409),同意后放行', async () => {
  const alpha = skillsByDir((await get(ctx.base, '/api/skills')).body, 'alpha')[0];
  const denied = await post(ctx.base, `/api/skills/${alpha.id}/translate`, { path: 'SKILL.md' });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error.code, 'consent_required');

  await post(ctx.base, '/api/consent', { accept: true });
  await waitFor(async () => {
    const st = await get(ctx.base, '/api/status');
    return !st.body.running;
  });

  const ok = await post(ctx.base, `/api/skills/${alpha.id}/translate`, { path: 'SKILL.md' });
  assert.equal(ok.status, 200);
});

test('08 块级对照:块 ID 对齐、代码块不译、占位符保护、单次上限', async () => {
  const data = (await get(ctx.base, '/api/skills')).body;
  const alpha = skillsByDir(data, 'alpha')[0];
  const doc = (await get(ctx.base, `/api/skills/${alpha.id}/doc?path=SKILL.md`)).body;
  const t = (await post(ctx.base, `/api/skills/${alpha.id}/translate`, { path: 'SKILL.md' })).body;

  const tmap = new Map(t.blocks.map((b) => [b.id, b]));
  for (const b of doc.blocks) {
    const tb = tmap.get(b.id);
    assert.ok(tb, `原文块 ${b.id} 应有对应译文块`);
    if (b.type === 'code') {
      assert.equal(tb.status, 'original');
      assert.equal(tb.translated, '', '代码块不被翻译');
    }
  }

  const stub = ctx.uapi.stats();
  assert.ok(!stub.overLimit, `单次调用不得超 1 万字符(max=${stub.maxLen})`);

  // 占位符保护:行内代码/URL/路径/环境变量原样保留,敏感词改写不波及
  const para = t.blocks.find((b) => b.src.includes('npm install skill-x'));
  assert.ok(para, '包含行内代码的块应存在');
  assert.match(para.translated, /npm install skill-x/, '行内代码保留原文');
  assert.ok(!para.translated.includes('技能X'), '占位符内的代码不被 stub 改写');
  assert.match(para.translated, /https:\/\/example\.com\/docs/, 'URL 保留');
  assert.match(para.translated, /~\/\.agents\/skills\/alpha/, '路径保留');
  assert.match(para.translated, /\$HOME_DIR/, '环境变量保留');

  const st = (await get(ctx.base, '/api/status')).body;
  assert.ok(st.state.creditsUsed > 0, '积分消耗对用户可见');
  assert.equal(st.state.creditsUsed % 4, 0, '每次调用 4 积分');
});

test('08 长文分块 + QPS 节流', async () => {
  const alpha = skillsByDir((await get(ctx.base, '/api/skills')).body, 'alpha')[0];
  // 懒翻译证明:分析/预翻译阶段从未碰过附属长文档
  assert.ok(!ctx.uapi.stats().hasText('Paragraph 0:'), '附属长文档不应在分析阶段被翻译(懒翻译)');
  const before = ctx.uapi.stats().calls;
  const t0 = Date.now();
  const t = await post(ctx.base, `/api/skills/${alpha.id}/translate`, { path: 'reference-long.md' });
  const elapsed = Date.now() - t0;
  assert.equal(t.status, 200);
  const newCalls = ctx.uapi.stats().calls - before;
  assert.ok(newCalls >= 3, `4 万字符长文应分多次调用,实际 ${newCalls}`);
  assert.ok(
    t.body.blocks.filter((b) => b.status === 'ok').length >= 80,
    '长文所有语义块均有译文且不撕裂',
  );
  assert.ok(elapsed >= (newCalls - 1) * 250 * 0.8, `4 QPS 节流生效:${newCalls} 次调用耗时 ${elapsed}ms`);
});

/* ---------- 09 懒翻译与增量缓存 ---------- */

test('09 附属文档缓存秒开 + 内容未变零调用', async () => {
  const alpha = skillsByDir((await get(ctx.base, '/api/skills')).body, 'alpha')[0];
  const afterFirst = ctx.uapi.stats().calls;

  const second = await post(ctx.base, `/api/skills/${alpha.id}/translate`, { path: 'reference-long.md' });
  assert.equal(second.status, 200);
  assert.equal(second.body.cached, true, '第二次读取走缓存');
  assert.equal(ctx.uapi.stats().calls, afterFirst, '缓存命中不产生新调用');

  // 内容未变的手动更新:零 API 调用。
  // 先跑一轮把 consent 后未预翻的入口补齐入缓存,再断言下一轮零调用。
  await runAnalysis(ctx.base);
  const beforeAnalyze = ctx.uapi.stats().calls;
  const llmBefore = ctx.llm.stats().calls;
  await runAnalysis(ctx.base);
  assert.equal(ctx.uapi.stats().calls, beforeAnalyze, '内容未变,重新分析零翻译调用');
  assert.equal(ctx.llm.stats().calls, llmBefore, '内容未变,概述与推断走缓存零 LLM 调用');
});

test('09 内容变更后自动重翻入口文档', async () => {
  const alpha = skillsByDir((await get(ctx.base, '/api/skills')).body, 'alpha')[0];
  const append = '\nBrand new paragraph after content change.\n';
  // alpha 与 alpha-copy(内容一致的拷贝)同步追加,保持"合并"不变式不被测试突变破坏
  fs.appendFileSync(path.join(FIXTURES, 'roots', 'agents', 'skills', 'alpha', 'SKILL.md'), append);
  fs.appendFileSync(path.join(FIXTURES, 'roots', 'claudeA', 'skills', 'alpha-copy', 'SKILL.md'), append);

  const before = ctx.uapi.stats().calls;
  await runAnalysis(ctx.base);
  const delta = ctx.uapi.stats().calls - before;
  assert.ok(delta >= 1, `alpha 内容变化应触发入口重翻,实际新增 ${delta} 次调用`);
  assert.ok(ctx.uapi.stats().hasText('Brand new paragraph after content change'), '重译的是新内容');
  const recount = (await get(ctx.base, '/api/skills')).body.stats.entities;
  assert.equal(recount, 7, '同步变更拷贝后实体数不变');
});

/* ---------- 10 LLM provider:概述与推断 ---------- */

test('10 概述生成与归属推断(stub LLM)', async () => {
  const data = (await get(ctx.base, '/api/skills')).body;
  const delta = skillsByDir(data, 'delta')[0];
  assert.equal(delta.summarySource, 'llm');
  assert.equal(delta.summary, 'LLM 生成的中文概述');

  // 高置信度推断自动纳入仓库分组
  assert.equal(delta.attribution.inferred, true);
  assert.equal(delta.attribution.repo, 'example/mono');
  assert.equal(delta.attribution.confidence, 'high');

  // 低置信度不自动纳入:留在未知来源,但携带候选供确认
  const lonely = skillsByDir(data, 'lonely')[0];
  assert.equal(lonely.attribution.repo, null, '低置信度推断不得自动纳入仓库');
  assert.ok(lonely.pendingInference, '低置信度保留推断候选');
  assert.equal(lonely.pendingInference.repo, 'hand/hand-repo');
  assert.equal(lonely.pendingInference.confidence, 'low');

  // 无候选技能不带字段
  const fork = skillsByDir(data, 'beta').find((b) => b.versionLabel === 'claudeA');
  assert.equal(fork.pendingInference, null);
});

test('10 未配置 LLM 时优雅降级,不报错不阻塞', async () => {
  const llmBefore = ctx.llm.stats().calls;
  const app2 = await startApp({ dataDir: path.join(TMP, 'data-degraded'), llmEnv: false });
  await runAnalysis(app2.base);
  const data = (await get(app2.base, '/api/skills')).body;
  const delta = skillsByDir(data, 'delta')[0];
  assert.equal(delta.summarySource, 'fallback', '降级为 frontmatter 描述');
  assert.equal(delta.summary, delta.description);
  assert.equal(delta.attribution.repo, null, '未配置 LLM 时不推断');
  assert.equal(ctx.llm.stats().calls, llmBefore, '没有 LLM 调用发生');
  assert.equal(data.stats.entities, 7, '功能不受影响');
  await closeServer(app2.server);
});

/* ---------- 11 手动归组与推断确认 ---------- */

test('11 overrides:手动归组最高优先级且重分析不丢,推断可确认', async () => {
  const data0 = (await get(ctx.base, '/api/skills')).body;
  const lonely = skillsByDir(data0, 'lonely')[0];

  // 确认低置信度候选:从未知来源转入对应仓库
  const confirm = await post(ctx.base, '/api/confirm-inference', { skillIds: [lonely.id] });
  assert.equal(confirm.status, 200);
  const data1 = (await get(ctx.base, '/api/skills')).body;
  const lonely1 = skillsByDir(data1, 'lonely')[0];
  assert.equal(lonely1.attribution.confirmed, true, '确认后不再显示待确认状态');
  assert.equal(lonely1.attribution.repo, 'hand/hand-repo');
  assert.equal(lonely1.pendingInference, null, '已确认的候选不再挂起');

  await runAnalysis(ctx.base);
  const data2 = (await get(ctx.base, '/api/skills')).body;
  assert.equal(skillsByDir(data2, 'lonely')[0].attribution.confirmed, true, '确认结果持久');

  // 手动归组优先级最高,可覆盖确认结果
  const assign = await post(ctx.base, '/api/overrides', { skillIds: [lonely.id], repo: 'custom/manual-repo' });
  assert.equal(assign.status, 200);
  const data3 = (await get(ctx.base, '/api/skills')).body;
  const lonely3 = skillsByDir(data3, 'lonely')[0];
  assert.equal(lonely3.attribution.method, 'overrides');
  assert.equal(lonely3.attribution.repo, 'custom/manual-repo');
  assert.equal(lonely3.attribution.manual, true);

  // 重新分析后手动归组保留
  await runAnalysis(ctx.base);
  const data4 = (await get(ctx.base, '/api/skills')).body;
  assert.equal(skillsByDir(data4, 'lonely')[0].attribution.method, 'overrides');
});

/* ---------- 12 失败重试与状态回看 ---------- */

test('12 翻译失败的块:错误可见、可重试、成功后缓存补齐', async () => {
  const gamma = skillsByDir((await get(ctx.base, '/api/skills')).body, 'gamma')[0];
  const t = await post(ctx.base, `/api/skills/${gamma.id}/translate`, { path: 'SKILL.md' });
  assert.equal(t.status, 200);
  const failed = t.body.blocks.filter((b) => b.status === 'failed');
  assert.ok(failed.length >= 1, '含 FAIL_TOKEN 的块应失败且不静默');
  assert.ok(failed.every((b) => b.error), '失败块带错误信息');

  // stub 关闭 FAIL_TOKEN 失败模式后重试成功
  await fetch(`http://127.0.0.1:${ctx.uapiPort}/__mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ failToken: false }),
  });
  const retry = await post(ctx.base, `/api/skills/${gamma.id}/retry`, { path: 'SKILL.md' });
  assert.equal(retry.status, 200);
  assert.ok(retry.body.retried >= 1, '重试了失败块');
  assert.ok(retry.body.blocks.every((b) => b.status !== 'failed'), '重试后全部成功');

  const again = await post(ctx.base, `/api/skills/${gamma.id}/translate`, { path: 'SKILL.md' });
  assert.ok(again.body.blocks.every((b) => b.status !== 'failed'), '缓存已补齐');
});

test('12 状态可回看:隐私提示、积分、进度、provider 配置', async () => {
  const st = (await get(ctx.base, '/api/status')).body;
  assert.equal(st.state.consentTranslate, true);
  assert.ok(st.state.creditsUsed > 0);
  assert.ok(st.state.lastAnalysis, '上次分析信息可回看');
  assert.equal(st.config.providers.translate.configured, true);
  assert.ok(st.phase, '进度结构存在');
  assert.ok(['done'].includes(st.phase.phase) || !st.running);
});

/* ---------- 13 静态 UI 冒烟 ---------- */

test('13 UI 冒烟:首页可渲染', async () => {
  const home = await get(ctx.base, '/');
  assert.equal(home.status, 200);
  assert.match(String(home.body), /app\.js/);
  const js = await get(ctx.base, '/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const spa = await get(ctx.base, '/whatever');
  assert.equal(spa.status, 200, '未知路径 SPA 兜底回首页');
});

/* ---------- 14 设置:加密存储、掩码回显、无明文落盘 ---------- */

test('14 设置 API:密钥加密落盘、掩码回显、data 目录无明文', async () => {
  const save = await post(ctx.base, '/api/settings/providers', {
    translate: { apiKey: 'store-uapis-key-1234567890' },
    llm: { preset: 'custom', baseUrl: `http://127.0.0.1:${ctx.llmPort}/v1`, model: 'stub-model', apiKey: 'store-llm-key-abcdef0987' },
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const st = (await get(ctx.base, '/api/settings')).body;
  assert.ok(st.translate.maskedKey.includes('***'), 'key 只回掩码');
  assert.ok(st.llm.maskedKey.includes('***'));
  assert.equal(st.llm.preset, 'custom');
  assert.equal(st.llm.baseUrl, `http://127.0.0.1:${ctx.llmPort}/v1`);
  assert.ok(st.presets.length >= 3, '预设列表下发(DeepSeek/GLM/custom)');
  assert.ok(['dpapi', 'keychain', 'secret-tool', 'machine'].includes(st.credentialStoreKind));

  const whole = JSON.stringify(st);
  assert.ok(!whole.includes('store-uapis-key-1234567890'), '完整 key 不得出现在响应');
  assert.ok(!whole.includes('store-llm-key-abcdef0987'));

  // 落盘检查:data 下所有文件都不得含明文 key
  const files = fs.readdirSync(DATA, { recursive: true });
  let leaked = [];
  for (const f of files) {
    const full = path.join(DATA, String(f));
    if (!fs.statSync(full).isFile()) continue;
    const content = fs.readFileSync(full, 'utf8');
    if (content.includes('store-uapis-key-1234567890') || content.includes('store-llm-key-abcdef0987')) leaked.push(String(f));
  }
  assert.deepEqual(leaked, [], `以下文件出现明文 key: ${leaked.join(', ')}`);
});

test('14 设置:清除已存密钥(直接观察加密存储)', async () => {
  // 主实例 env 密钥优先级更高,观察不到 store;开一个无 env 的实例读同一 dataDir
  const app3 = await startApp({ dataDir: DATA, llmEnv: false, translateEnv: false });
  try {
    await post(app3.base, '/api/settings/providers', { translate: { apiKey: 'to-be-cleared-123456' } });
    let st = (await get(app3.base, '/api/settings')).body;
    assert.equal(st.translate.source, 'store');
    assert.match(st.translate.maskedKey, /\*\*\*/);

    const clear = await post(app3.base, '/api/settings/providers', { translate: { apiKey: null } });
    assert.equal(clear.status, 200);
    st = (await get(app3.base, '/api/settings')).body;
    assert.notEqual(st.translate.source, 'store', '清除后不再有存储密钥');
    assert.equal(st.translate.maskedKey, null, '无 env 且无 store → 掩码为空');
  } finally {
    await closeServer(app3.server);
  
  }
});

/* ---------- 15 连通测试(stub) ---------- */

test('15 连通测试:LLM models 探测、翻译免费探针与完整测试', async () => {
  // LLM:上一测试已把 stub 地址与存储密钥写入设置,空参 = 用已存配置
  const ok = await post(ctx.base, '/api/settings/test/llm', {});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.ok(ok.body.models.includes('stub-model'), '返回模型列表');
  assert.ok(ok.body.latencyMs >= 0);

  const bad = await post(ctx.base, '/api/settings/test/llm', { apiKey: 'wrong-key' });
  assert.equal(bad.body.ok, false, '坏 key 应失败');
  assert.match(bad.body.error, /鉴权失败/);

  // 翻译免费探针:可达 + keyAccepted(env 的 stub-key 仍生效)
  const probe = await post(ctx.base, '/api/settings/test/translate', {});
  assert.equal(probe.body.reachable, true);
  assert.equal(probe.body.keyAccepted, true, 'stub:有 Bearer + 空 text → 400 = 鉴权通过');

  const invalid = await post(ctx.base, '/api/settings/test/translate', { apiKey: 'nope' });
  assert.equal(invalid.body.keyAccepted, false, '坏 key → 401');

  // 完整测试:真实调用 +1 次
  const callsBefore = ctx.uapi.stats().calls;
  const full = await post(ctx.base, '/api/settings/test/translate', { full: true });
  assert.equal(full.body.full.ok, true);
  assert.match(full.body.full.sample, /【译】hi/);
  assert.equal(ctx.uapi.stats().calls, callsBefore + 1, '完整测试只发起一次计费调用');
});

/* ---------- 16 跨源防护 ---------- */

test('16 跨源防护:伪造 Origin 的状态变更被拒,同源放行', async () => {
  const evil = await fetch(ctx.base + '/api/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    body: '{"accept":true}',
  });
  assert.equal(evil.status, 403);
  assert.equal((await evil.json()).error.code, 'forbidden_origin');

  const evilSettings = await fetch(ctx.base + '/api/settings/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.test' },
    body: '{"translate":{"apiKey":"evil-injected"}}',
  });
  assert.equal(evilSettings.status, 403);

  const sameOrigin = await fetch(ctx.base + '/api/analyze', {
    method: 'POST',
    headers: { Origin: ctx.base },
  });
  assert.equal(sameOrigin.status, 200, '同源(页面自身)POST 放行');
});

/* ---------- 20 清除上次警告 ---------- */

test('20 清除警告端点:幂等且只清 errors 不动其他状态', async () => {
  // 先确认契约:调用成功、响应结构正确
  const r = await post(ctx.base, '/api/clear-warnings');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const st = (await get(ctx.base, '/api/status')).body;
  assert.deepEqual(st.state.lastAnalysis.errors, [], '警告已清空');
  assert.ok(st.state.lastAnalysis.entities > 0, 'lastAnalysis 其他字段保留');
  assert.equal(st.state.consentTranslate, true, '同意状态不受影响');
});

/* ---------- 18 并发翻译去重 + 贴满字符打包 ---------- */

test('18 同一文档并发翻译只翻一份(in-flight 去重),打包贴满单次上限', async () => {
  const app4 = await startApp({ dataDir: path.join(TMP, 'data-inflight') });
  try {
    await post(app4.base, '/api/consent', { accept: true });
    await waitFor(async () => {
      const st = await get(app4.base, '/api/status');
      return !st.body.running;
    });

    const alpha = skillsByDir((await get(app4.base, '/api/skills')).body, 'alpha')[0];
    const before = ctx.uapi.stats().calls;
    const [r1, r2] = await Promise.all([
      post(app4.base, `/api/skills/${alpha.id}/translate`, { path: 'reference-long.md' }),
      post(app4.base, `/api/skills/${alpha.id}/translate`, { path: 'reference-long.md' }),
    ]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const used = ctx.uapi.stats().calls - before;
    assert.equal(used, r1.body.calls, `并发两请求应共享同一份翻译(stub 调用 ${used} = 文档记录 ${r1.body.calls}),而不是翻两遍`);
    assert.ok(r1.body.calls >= 4, '4 万字符长文按 ~9900/包应分 ≥4 次');
    assert.ok(ctx.uapi.stats().maxLen <= 10000, `单次调用不得超 1 万字符(max=${ctx.uapi.stats().maxLen})`);
    assert.ok(ctx.uapi.stats().maxLen > 9000, `打包应贴满单次字符上限(max=${ctx.uapi.stats().maxLen})`);
  } finally {
    await closeServer(app4.server);
  
  }
});

/* ---------- 19 consent 触发的分析不做全量预翻 ---------- */

test('19 用户刚同意隐私时不启动全量预翻(避免与当前文档抢节流队列)', async () => {
  const app5 = await startApp({ dataDir: path.join(TMP, 'data-consent-noPre') });
  try {
    const before = ctx.uapi.stats().calls;
    await post(app5.base, '/api/consent', { accept: true });
    await waitFor(async () => {
      const st = await get(app5.base, '/api/status');
      return !st.body.running;
    });
    assert.equal(ctx.uapi.stats().calls, before, 'consent 触发的分析零翻译调用(不预翻)');

    // 手动更新时才补预翻(consent 已 true)
    await runAnalysis(app5.base);
    const afterManual = ctx.uapi.stats().calls;
    assert.ok(afterManual > before, '手动更新按同意状态执行预翻');
  } finally {
    await closeServer(app5.server);
  
  }
});

/* ---------- 17 无环境变量时走加密存储的密钥(端到端) ---------- */

test('17 存储密钥端到端:无环境变量时 LLM 概述与翻译均走加密存储', async () => {
  const app2 = await startApp({ dataDir: path.join(TMP, 'data-storeonly'), llmEnv: false, translateEnv: false });
  try {
    assert.equal(app2.llmProvider.configured(), false, '初始未配置');
    const save = await post(app2.base, '/api/settings/providers', {
      translate: { apiKey: 'stub-key' },
      llm: { preset: 'custom', baseUrl: `http://127.0.0.1:${ctx.llmPort}/v1`, model: 'stub-model', apiKey: 'stub-llm-key' },
    });
    assert.equal(save.body.analysisStarted, true, '配置完成自动触发分析');
    await runAnalysis(app2.base);

    assert.equal(app2.llmProvider.configured(), true, '存储密钥让 LLM 就绪');
    assert.equal(app2.translateProvider.configured(), true, '存储密钥让翻译就绪');

    const data = (await get(app2.base, '/api/skills')).body;
    const delta = data.skills.find((s) => s.dirName === 'delta');
    assert.equal(delta.summarySource, 'llm', '概述由存储密钥驱动的 LLM 生成');
    assert.equal(delta.attribution.repo, 'example/mono', '归属推断同样生效');

    // 翻译链路
    await post(app2.base, '/api/consent', { accept: true });
    await waitFor(async () => {
      const st = await get(app2.base, '/api/status');
      return !st.body.running;
    });
    const t = await post(app2.base, `/api/skills/${delta.id}/translate`, { path: 'SKILL.md' });
    assert.equal(t.status, 200, '翻译走存储密钥');
  } finally {
    await closeServer(app2.server);
  
  }
});
