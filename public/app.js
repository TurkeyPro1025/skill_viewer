'use strict';

/* global document, fetch, window, localStorage, matchMedia, encodeURIComponent, setTimeout */

/* ============ 状态 ============ */
const S = {
  data: null,          // /api/skills 响应
  status: null,        // /api/status 响应
  q: '',
  cat: null,           // 分类筛选:单选(null = 未选)
  collapsed: new Set(),
  selectMode: false,
  selection: new Set(),
  viewer: null,        // { skill, docs, doc, translation }
  pollTimer: null,
  appearance: null,    // { theme: 'auto'|'dark'|'light', density: 'comfortable'|'compact' }
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function api(path, opts) {
  const res = await fetch(path, opts);
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.code = body?.error?.code;
    err.status = res.status;
    throw err;
  }
  return body;
}

function toast(msg, isError) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', Boolean(isError));
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3400);
}

/* ============ 外观(主题/密度,仅本机 localStorage) ============ */
const APPEARANCE_KEY = 'skill-viewer:appearance';
const DEFAULT_APPEARANCE = { theme: 'auto', density: 'comfortable' };

function loadAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}');
    const theme = ['auto', 'dark', 'light'].includes(saved.theme) ? saved.theme : 'auto';
    const density = saved.density === 'compact' ? 'compact' : 'comfortable';
    return { theme, density };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

function saveAppearance() {
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(S.appearance)); } catch { /* 隐私模式等场景静默 */ }
}

function effectiveTheme() {
  const t = S.appearance?.theme;
  if (t === 'dark' || t === 'light') return t;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyAppearance() {
  const root = document.documentElement;
  if (S.appearance.theme === 'dark' || S.appearance.theme === 'light') root.dataset.theme = S.appearance.theme;
  else delete root.dataset.theme; // auto:交给 CSS 媒体查询
  root.dataset.density = S.appearance.density;
  const btn = $('btn-theme');
  if (btn) {
    const eff = effectiveTheme();
    btn.textContent = eff === 'dark' ? '☾' : '☀';
    btn.title = eff === 'dark' ? '当前深色,点击切浅色' : '当前浅色,点击切深色';
  }
  const themeSel = $('app-theme');
  if (themeSel) themeSel.value = S.appearance.theme;
  const densitySel = $('app-density');
  if (densitySel) densitySel.value = S.appearance.density;
}

function toggleTheme() {
  S.appearance.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  saveAppearance();
  applyAppearance();
}

/* ============ 键盘导航 ============ */
function isTypingTarget(e) {
  const t = e.target;
  return Boolean(t) && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function moveCardFocus(dir) {
  const cards = document.querySelectorAll('#groups .card');
  if (!cards.length) return;
  const list = [...cards];
  const idx = list.indexOf(document.activeElement);
  const next = idx === -1
    ? (dir > 0 ? list[0] : list[list.length - 1])
    : list[Math.min(list.length - 1, Math.max(0, idx + dir))];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}

/** 查看器内切换文档([ / ]) */
function switchDoc(delta) {
  const items = [...document.querySelectorAll('.doc-item')];
  const idx = items.findIndex((el) => el.classList.contains('on'));
  const next = items[idx + delta];
  if (next) next.click();
}

/* ============ 初始化 ============ */
async function boot() {
  S.appearance = loadAppearance();
  applyAppearance();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyAppearance);
  $('btn-theme').addEventListener('click', toggleTheme);
  $('app-theme').addEventListener('change', () => { S.appearance.theme = $('app-theme').value; saveAppearance(); applyAppearance(); });
  $('app-density').addEventListener('change', () => { S.appearance.density = $('app-density').value; saveAppearance(); applyAppearance(); });

  $('search').addEventListener('input', (e) => { S.q = e.target.value.trim(); renderGroups(); });
  $('btn-update').addEventListener('click', manualUpdate);
  $('btn-organize').addEventListener('click', toggleSelectMode);
  $('btn-info').addEventListener('click', toggleInfo);
  $('btn-cancel-select').addEventListener('click', () => toggleSelectMode(false));
  $('btn-assign').addEventListener('click', () => assignSelection($('repo-select').value));
  $('repo-select').addEventListener('change', () => { $('btn-assign').disabled = !$('repo-select').value; });
  // 模型下拉:选「手动输入」切换到文本框
  $('llm-model-select').addEventListener('change', () => {
    if ($('llm-model-select').value === '__custom__') {
      $('llm-model-select').hidden = true;
      const input = $('llm-model-input');
      input.hidden = false;
      input.value = '';
      input.focus();
    }
  });
  $('btn-unknown').addEventListener('click', () => assignSelection(''));
  $('btn-confirm').addEventListener('click', confirmInference);
  $('viewer-close').addEventListener('click', closeViewer);
  $('consent-cancel').addEventListener('click', () => hideConsent(false));
  $('consent-accept').addEventListener('click', () => hideConsent(true));
  $('btn-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => { $('settings-modal').hidden = true; });
  $('settings-save').addEventListener('click', saveSettings);
  $('llm-preset').addEventListener('change', applyPresetSelection);
  $('btn-test-translate').addEventListener('click', () => testTranslateFromUI(false));
  $('btn-test-translate-full').addEventListener('click', () => testTranslateFromUI(true));
  $('btn-test-llm').addEventListener('click', testLlmFromUI);
  $('btn-clear-translate').addEventListener('click', () => clearStoredKey('translate'));
  $('btn-clear-llm').addEventListener('click', () => clearStoredKey('llm'));

  await refreshData();
  pollStatus();
  setInterval(pollStatus, 4000);
}

async function refreshData() {
  try {
    const [skills, categories] = await Promise.all([
      api('/api/skills'),
      api('/api/categories'),
    ]);
    S.data = skills;
    S.data.categories = categories.categories || [];
  } catch (err) {
    if (err.code === 'no_index') {
      $('stats-line').textContent = '首次分析进行中…';
    } else {
      $('stats-line').textContent = `加载失败:${err.message}`;
    }
    return;
  }
  renderCategories();
  renderGroups();
  renderStats();
}

async function pollStatus() {
  try {
    S.status = await api('/api/status');
  } catch { return; }
  renderProgress();
  if (!S.status.hasIndex && S.data === null) setTimeout(refreshData, 1200);
  if (S.status.running && S._wasRunning === false) refreshData();
  S._wasRunning = S.status.running;
  if (S.status.running && S.data) {
    // 分析完成后刷新一次列表
    clearTimeout(pollStatus._refresh);
    pollStatus._refresh = setTimeout(refreshData, 600);
  }
}

async function manualUpdate() {
  $('btn-update').disabled = true;
  try {
    await api('/api/analyze', { method: 'POST', body: '{}' });
    toast('已开始重新分析(增量:内容未变不调 API)');
  } catch (err) {
    toast(`触发失败:${err.message}`, true);
  } finally {
    $('btn-update').disabled = false;
  }
}

function renderStats() {
  const d = S.data;
  if (!d) return;
  const groupCount = d.groups.filter((g) => g.key !== '__unknown__').length;
  $('stats-line').textContent =
    `${d.stats.entities} 技能 · ${groupCount} 仓库 · 已归属 ${d.stats.attributed}` +
    (d.stats.inferred ? ` · 待确认推断 ${d.stats.inferred}` : '');
}

function renderProgress() {
  const ph = S.status?.phase;
  const running = S.status?.running;
  const wrap = $('progress-wrap');
  if (!running || !ph || ph.phase === 'idle' || ph.phase === 'done') {
    if (ph?.phase === 'done' && running) {
      wrap.hidden = false;
      $('progress-fill').style.width = '100%';
      $('progress-text').textContent = ph.detail;
      return;
    }
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const pct = ph.total ? Math.round((ph.done / ph.total) * 100) : 12;
  $('progress-fill').style.width = `${Math.max(pct, 8)}%`;
  $('progress-text').textContent = `${phaseName(ph.phase)} ${ph.done}/${ph.total || '?'} · ${ph.detail || ''}`;
}

function phaseName(p) {
  return { scan: '扫描', attribute: '归属', summaries: '概述', pretranslate: '预翻译入口文档' }[p] || p;
}

/* ============ 分类筛选 ============ */
function renderCategories() {
  const box = $('category-chips');
  box.innerHTML = '';
  for (const c of S.data.categories || []) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (S.cat === c.name ? ' on' : '');
    chip.innerHTML = `${esc(c.name)}<small>${c.count}</small>`;
    chip.tabIndex = 0;
    chip.setAttribute('role', 'button');
    chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } };
    chip.onclick = () => {
      S.cat = S.cat === c.name ? null : c.name; // 单选:再点一次取消
      renderCategories();
      renderGroups();
    };
    box.appendChild(chip);
  }
}

/* ============ 过滤(纯前端,不发请求) ============ */
function matches(card, group) {
  if (S.cat && !(card.categories || []).includes(S.cat)) return false;
  if (!S.q) return true;
  const q = S.q.toLowerCase();
  const hay = [
    card.name, card.dirName, card.displayName, card.description, card.summary,
    card.categories.join(' '), group ? group.repo : '',
  ].join(' ').toLowerCase();
  return hay.includes(q);
}

/* ============ 列表渲染 ============ */
function renderGroups() {
  const box = $('groups');
  box.innerHTML = '';
  let visibleTotal = 0;

  for (const group of S.data.groups) {
    const subgroups = [];
    let visible = 0;
    const isUnknown = group.key === '__unknown__';
    const lowConf = [];

    for (const sg of group.subgroups) {
      for (const c of sg.skills) {
        if (!matches(c, group)) continue;
        // 低置信度且未确认的推断结果默认收进折叠区(spec 12)
        if (isLowConfidence(c)) { lowConf.push(c); continue; }
        const named = subgroups.find((x) => x.name === sg.name);
        if (named) named.skills.push(c); else subgroups.push({ name: sg.name, skills: [c] });
        visible++;
      }
    }
    if (lowConf.length) {
      subgroups.push({ name: '__lowconf__', skills: lowConf });
      visible += lowConf.length;
    }

    visibleTotal += visible;
    if (!visible) continue;

    const sec = document.createElement('section');
    sec.className = 'group' + (S.collapsed.has(group.key) ? ' closed' : '');

    const head = document.createElement('div');
    head.className = 'group-head';
    head.onclick = () => {
      if (S.collapsed.has(group.key)) S.collapsed.delete(group.key); else S.collapsed.add(group.key);
      renderGroups();
    };
    const ghBtn = group.sourceUrl
      ? `<a class="gh-link" href="${esc(group.sourceUrl)}" target="_blank" rel="noreferrer" title="在 GitHub 打开 ${esc(group.name)}" onclick="event.stopPropagation()">↗ GitHub</a>`
      : '';
    head.innerHTML = `
      <span class="caret">▼</span>
      <span class="group-title">${esc(group.name)}</span>
      ${ghBtn}
      <span class="group-count">${visible} 技能</span>
      ${isUnknown ? '' : '<span class="group-source-badge">安装来源</span>'}
      ${group.repoSummary ? `<p class="group-summary">${esc(group.repoSummary)}</p>` : ''}`;
    sec.appendChild(head);

    const body = document.createElement('div');
    body.className = 'group-body';
    for (const sg of subgroups) {
      if (!sg.skills.length) continue;
      if (sg.name === '__lowconf__') {
        const det = document.createElement('details');
        det.className = 'subgroup lowconf';
        det.innerHTML = `<summary><span class="caret">▼</span>低置信度推断<small>${sg.skills.length}</small></summary>`;
        det.appendChild(cardsGrid(sg.skills));
        body.appendChild(det);
        continue;
      }
      if (sg.name) {
        // 仓库内分组:可折叠,默认展开
        const det = document.createElement('details');
        det.className = 'subgroup';
        det.open = true;
        det.innerHTML = `<summary><span class="caret">▼</span>${esc(sg.name)}<small>${sg.skills.length}</small></summary>`;
        det.appendChild(cardsGrid(sg.skills));
        body.appendChild(det);
        continue;
      }
      body.appendChild(cardsGrid(sg.skills));
    }
    sec.appendChild(body);
    box.appendChild(sec);
  }

  $('empty-state').hidden = visibleTotal > 0;
  $('empty-hint').textContent = S.q || S.cat ? '试试更短的关键词,或取消分类筛选' : '';
}

function isLowConfidence(c) {
  return c.attribution?.inferred && !c.attribution.confirmed && c.attribution.confidence === 'low';
}

function cardsGrid(cards) {
  const grid = document.createElement('div');
  grid.className = 'cards';
  for (const card of cards) grid.appendChild(cardEl(card));
  return grid;
}

function cardEl(card) {
  const el = document.createElement('div');
  el.className = 'card' + (S.selectMode ? ' selecting' : '') + (S.selection.has(card.id) ? ' selected' : '');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `打开技能 ${card.name}`);

  const badges = [];
  for (const r of card.roots) {
    badges.push(`<span class="badge ${r.linked ? 'badge-root linked' : 'badge-root'}" title="${r.linked ? '链接到该工具根目录' : '实体所在根目录'}">${esc(r.label)}${r.linked ? ' ↗' : ''}</span>`);
  }
  if (card.copyCount > 1) badges.push(`<span class="badge badge-copy" title="内容一致的独立拷贝已合并">${card.copyCount} 份拷贝已合并</span>`);
  const a = card.attribution;
  if (a) {
    if (a.inferred && !a.confirmed) {
      badges.push(`<span class="badge badge-infer">推断${a.confidence ? ' · ' + esc(confZh(a.confidence)) : ''} → ${esc(a.repo)}</span>`);
    } else if (a.inferred && a.confirmed) {
      badges.push(`<span class="badge badge-confirm" title="你已确认此推断">已确认推断</span>`);
    }
    if (a.method === 'overrides') badges.push('<span class="badge badge-confirm" title="手动归组">手动</span>');
    if (a.upstream) badges.push(`<span class="badge badge-upstream" title="frontmatter 记录的创作上游(非安装来源)">创作上游:${esc(a.upstream.repo)}</span>`);
  }
  if (card.pendingInference) {
    badges.push(`<span class="badge badge-infer" title="LLM 推断候选(置信度不够未自动纳入)。到「整理归属」勾选后可一键确认。">推断候选:${esc(card.pendingInference.repo)} · ${esc(confZh(card.pendingInference.confidence))}</span>`);
  }
  if (card.forked) badges.push(`<span class="badge badge-fork" title="同名技能内容分岔,作为独立版本展示">变体 · ${esc(card.versionLabel || '')}</span>`);
  if (card.entryLanguage === 'zh') badges.push('<span class="badge badge-zh">中文</span>');

  const cats = (card.categories || [])
    .map((c) => `<span class="cat-tag" data-cat="${esc(c)}">${esc(c)}</span>`).join('');

  el.innerHTML = `
    <input type="checkbox" class="card-check" style="display:${S.selectMode ? 'block' : 'none'}" ${S.selection.has(card.id) ? 'checked' : ''}>
    <div class="card-title-row">
      <span class="card-name">${esc(card.name)}</span>
      ${card.dirName !== card.name ? `<span class="card-dirname">${esc(card.dirName)}</span>` : ''}
    </div>
    <div class="badges">${badges.join('')}</div>
    <div class="card-summary ${card.summarySource || ''}">${esc(card.summary || '')}</div>
    ${card.categories?.length ? `<div class="card-cats">${cats}</div>` : ''}
    ${card.summarySource === 'fallback' ? '' : `<div class="card-desc">${esc(card.description || '')}</div>`}`;

  el.querySelector('.card-check').onclick = (e) => {
    e.stopPropagation();
    if (S.selection.has(card.id)) S.selection.delete(card.id); else S.selection.add(card.id);
    renderGroups();
    renderSelectionBar();
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
  };
  el.onclick = (e) => {
    const cat = e.target.closest('.cat-tag');
    if (cat) {
      S.cat = cat.dataset.cat; // 单选:点卡片标签即选中该分类
      renderCategories();
      renderGroups();
      return;
    }
    if (S.selectMode) {
      if (S.selection.has(card.id)) S.selection.delete(card.id); else S.selection.add(card.id);
      renderGroups();
      renderSelectionBar();
      return;
    }
    openViewer(card.id);
  };
  return el;
}

function confZh(c) {
  return { high: '高', medium: '中', low: '低' }[c] || c;
}

/* ============ 整理归属(多选 + overrides) ============ */
function toggleSelectMode(force) {
  S.selectMode = typeof force === 'boolean' ? force : !S.selectMode;
  if (!S.selectMode) S.selection.clear();
  $('organize-label').textContent = S.selectMode ? '退出整理' : '整理归属';
  // ghost 与 primary 互斥:共存时 hover 会白字白底(.btn-ghost:hover 白底 + .btn-primary:hover 白字)
  $('btn-organize').classList.toggle('btn-primary', S.selectMode);
  $('btn-organize').classList.toggle('btn-ghost', !S.selectMode);
  renderSelectionBar();
  renderGroups();
}

function renderSelectionBar() {
  const bar = $('selection-bar');
  bar.hidden = !S.selectMode;
  $('selection-count').textContent = `已选 ${S.selection.size} 个技能`;
  const sel = $('repo-select');
  const repos = (S.data?.groups || []).filter((g) => g.key !== '__unknown__').map((g) => g.repo);
  sel.innerHTML = '<option value="">— 选择目标仓库 —</option>' +
    repos.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('') +
    '<option value="__custom__">✎ 输入自定义仓库…</option>';
  $('btn-assign').disabled = !sel.value; // 未选目标仓库时置灰
  const hasInfer = [...S.selection].some((id) => {
    const c = (S.data?.skills || []).find((x) => x.id === id);
    return (c?.attribution?.inferred && !c.attribution.confirmed) || c?.pendingInference;
  });
  $('btn-confirm').style.display = hasInfer ? '' : 'none';
}

async function assignSelection(repo) {
  if (!S.selection.size) return toast('先勾选技能卡片', true);
  let target = repo;
  if (repo === '__custom__') {
    target = window.prompt('目标仓库(owner/repo),留空则移入未知来源:', '');
    if (target === null) return;
    target = target.trim();
  } else if (!repo && !window.confirm(`把 ${S.selection.size} 个技能移入"未知来源"?`)) {
    return;
  }
  try {
    await api('/api/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillIds: [...S.selection], repo: target || null }),
    });
    toast(`已归组 ${S.selection.size} 个技能`);
    S.selection.clear();
    renderSelectionBar();
    await refreshData();
  } catch (err) {
    toast(`归组失败:${err.message}`, true);
  }
}

async function confirmInference() {
  if (!S.selection.size) return toast('先勾选要确认的技能', true);
  try {
    await api('/api/confirm-inference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillIds: [...S.selection] }),
    });
    toast('已确认推断归属');
    S.selection.clear();
    renderSelectionBar();
    await refreshData();
  } catch (err) {
    toast(`确认失败:${err.message}`, true);
  }
}

/* ============ 查看器 ============ */
async function openViewer(skillId, docPath) {
  let detail;
  try {
    detail = await api(`/api/skills/${skillId}`);
  } catch (err) {
    return toast(`打开失败:${err.message}`, true);
  }
  S.viewer = { skill: detail, doc: null, translation: null };
  $('viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  $('viewer-skill').textContent = detail.displayName || detail.name;
  renderDocList(detail);
  loadDoc(docPath || 'SKILL.md');
}

function closeViewer() {
  $('viewer').hidden = true;
  document.body.style.overflow = '';
  S.viewer = null;
}

/** 文档路径 → 面包屑(最后一段高亮) */
function renderBreadcrumb(docPath) {
  const parts = String(docPath || '').split('/').filter(Boolean);
  $('viewer-path').innerHTML = parts.length
    ? parts.map((p, i) => `<span class="crumb${i === parts.length - 1 ? ' crumb-last' : ''}">${esc(p)}</span>`)
        .join('<span class="crumb-sep">/</span>')
    : '';
}

function renderDocList(detail) {
  const box = $('viewer-docs');
  box.innerHTML = '';
  for (const d of detail.docs || []) {
    const b = document.createElement('button');
    b.className = 'doc-item';
    b.dataset.path = d.rel;
    b.textContent = d.rel;
    b.title = d.rel;
    b.onclick = () => loadDoc(d.rel);
    box.appendChild(b);
  }
  if (detail.copies?.length) {
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:10px;color:var(--ink-3);font-size:11px';
    note.textContent = `另有 ${detail.copies.length} 份一致拷贝(已合并)`;
    box.appendChild(note);
  }
}

async function loadDoc(docPath) {
  const v = S.viewer;
  if (!v) return;
  document.querySelectorAll('.doc-item').forEach((el) => el.classList.toggle('on', el.dataset.path === docPath));
  renderBreadcrumb(docPath);
  $('viewer-meta').innerHTML = '';
  let doc;
  try {
    doc = await api(`/api/skills/${v.skill.id}/doc?path=${encodeURIComponent(docPath)}`);
  } catch (err) {
    $('viewer-content').innerHTML = `<div class="doc-note error">文档读取失败:${esc(err.message)}</div>`;
    return;
  }
  v.doc = doc;
  v.translation = null;

  if (doc.language === 'zh') {
    renderSingleColumn(doc);
    return;
  }
  renderBilingual(doc, null);
  // 英文文档:尝试取译文(缓存命中则直接展示)
  fetchTranslation();
}

async function fetchTranslation({ retry } = {}) {
  const v = S.viewer;
  if (!v) return;
  const action = retry ? 'retry' : 'translate';
  try {
    setStatusBanner(`<span class="spin"></span>${retry ? '重试失败块' : '翻译中'}…(4 积分/次,内容未变会缓存;长文档自动分块,可能需要数十秒)`);
    const t = await api(`/api/skills/${v.skill.id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: v.doc.path }),
    });
    if (t.language === 'zh' || !t.blocks) {
      renderSingleColumn(v.doc);
      return;
    }
    v.translation = t;
    setStatusBanner('');
    renderBilingual(v.doc, t);
  } catch (err) {
    if (err.code === 'consent_required') {
      setStatusBanner('开启中英对照需要先同意隐私提示。', false);
      showConsent();
    } else if (err.code === 'provider_unconfigured') {
      setStatusBanner('翻译未配置:到右上角 ⚙ 设置保存 UApiPro API key 后,即可开启中英对照阅读。', false);
    } else {
      setStatusBanner(`翻译失败:${esc(err.message)} <button class="btn" id="btn-retry-trans">重试</button>`, true);
      $('btn-retry-trans').onclick = () => fetchTranslation({ retry: true });
    }
  }
}

/** 查看器内容顶部的状态横幅(翻译进度/未配置/失败重试/隐私等待) */
function setStatusBanner(html, isError) {
  const content = $('viewer-content');
  let el = $('tr-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tr-status';
    content.insertBefore(el, content.firstChild);
  }
  el.className = 'doc-note' + (isError ? ' error' : '');
  el.innerHTML = html || '';
  if (!html) el.remove();
}

function showConsent() {
  $('consent-modal').hidden = false;
}

function hideConsent(accept) {
  $('consent-modal').hidden = true;
  if (accept) {
    api('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: true }),
    })
      .then(() => fetchTranslation())
      .catch((err) => toast(`同意失败:${err.message}`, true));
  } else {
    setStatusBanner('未开启翻译,仅展示原文。<button class="btn" id="btn-open-consent">开启中英对照</button>', false);
    $('btn-open-consent').onclick = showConsent;
  }
}

function renderSingleColumn(doc) {
  $('viewer-meta').innerHTML = '<span class="badge badge-zh">中文原文 · 单栏直出</span>';
  const box = $('viewer-content');
  box.innerHTML = '<div class="single-col md"></div>';
  const col = box.firstChild;
  const skillId = S.viewer.skill.id;
  for (const b of doc.blocks) {
    col.insertAdjacentHTML('beforeend', renderBlockMarkdown(b, skillId, doc.path));
  }
}

function renderBilingual(doc, translation) {
  const tmap = new Map((translation?.blocks || []).map((b) => [b.id, b]));
  const failed = [...tmap.values()].some((b) => b.status === 'failed');
  const cached = Boolean(translation?.cached);
  $('viewer-meta').innerHTML =
    `<span>左:原文</span><span>右:译文</span>` +
    (cached ? '<span class="badge badge-confirm">已缓存 · 0 积分</span>' : '') +
    (failed ? '<button class="btn" id="btn-retry-doc">重试失败块</button>' : '');

  const retryBtn = $('btn-retry-doc');
  if (retryBtn) retryBtn.onclick = () => fetchTranslation({ retry: true });

  const box = $('viewer-content');
  box.innerHTML = '<div class="bilingual"></div>';
  const wrap = box.firstChild;
  const skillId = S.viewer.skill.id;

  for (const b of doc.blocks) {
    const row = document.createElement('div');
    if (b.type === 'code' || b.type === 'hr') {
      row.className = 'brow full';
      row.innerHTML = renderBlockMarkdown(b, skillId, doc.path);
    } else {
      row.className = 'brow';
      const t = tmap.get(b.id);
      let dstHtml;
      if (!translation) {
        dstHtml = '<div class="b-dst empty-note">等待翻译…</div>';
      } else if (t?.status === 'ok') {
        dstHtml = `<div class="b-dst md">${renderBlockMarkdown({ ...b, markdown: t.translated }, skillId, doc.path)}</div>`;
      } else if (t?.status === 'failed') {
        dstHtml = `<div class="b-dst failed">⚠ 翻译失败:${esc(t.error || '未知错误')}</div>`;
      } else if (t?.status === 'pending') {
        dstHtml = '<div class="b-dst pending">翻译中…</div>';
      } else {
        dstHtml = '<div class="b-dst empty-note">(未翻译)</div>';
      }
      row.innerHTML = `<div class="b-src md">${renderBlockMarkdown(b, skillId, doc.path)}</div>${dstHtml}`;
    }
    wrap.appendChild(row);
  }
}

/* ============ Markdown 渲染(浏览器端,零依赖) ============ */
function renderBlockMarkdown(block, skillId, docPath) {
  const src = block.markdown ?? '';
  switch (block.type) {
    case 'heading': return renderHeading(src, skillId, docPath);
    case 'code': return renderCode(src);
    case 'hr': return '<hr>';
    case 'list': return renderList(src, skillId, docPath);
    case 'quote': return renderQuote(src, skillId, docPath);
    case 'table': return renderTable(src, skillId, docPath);
    default: return `<p>${renderInline(src, skillId, docPath)}</p>`;
  }
}

function renderHeading(src, skillId, docPath) {
  const m = /^(#{1,6})\s+(.*)$/.exec(src.trim());
  if (!m) return `<p>${renderInline(src, skillId, docPath)}</p>`;
  const level = m[1].length;
  return `<h${level}>${renderInline(m[2], skillId, docPath)}</h${level}>`;
}

function renderCode(src) {
  const m = /^```\w*\n([\s\S]*?)\n?```$/.exec(src.trim()) || /^(`{3,})\w*\n([\s\S]*)\1$/.exec(src.trim());
  const code = m ? (m[2] ?? m[1]) : src;
  return `<pre><code>${esc(code)}</code></pre>`;
}

function renderList(src, skillId, docPath) {
  const lines = src.split('\n');
  const items = [];
  let ordered = false;
  for (const line of lines) {
    const m = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (!m) continue;
    if (/\d/.test(m[1])) ordered = true;
    items.push(m[2]);
  }
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((i) => `<li>${renderInline(i, skillId, docPath)}</li>`).join('')}</${tag}>`;
}

function renderQuote(src, skillId, docPath) {
  const inner = src.split('\n').map((l) => l.replace(/^\s*>\s?/, '')).join('\n');
  const paras = inner.split(/\n\n+/).map((p) => `<p>${renderInline(p.replace(/\n/g, ' '), skillId, docPath)}</p>`).join('');
  return `<blockquote>${paras}</blockquote>`;
}

function renderTable(src, skillId, docPath) {
  const rows = src.split('\n').filter((l) => l.trim());
  if (rows.length < 2) return `<p>${renderInline(src, skillId, docPath)}</p>`;
  const cells = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const bodyRows = rows.slice(2).map(cells);
  return `<table><thead><tr>${head.map((c) => `<th>${renderInline(c, skillId, docPath)}</th>`).join('')}</tr></thead>` +
    `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, skillId, docPath)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderInline(text, skillId, docPath) {
  let out = esc(text);
  // 行内代码
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\x00${codes.length - 1}\x00`;
  });
  // 图片
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => {
    return `<img src="${esc(fileUrl(skillId, docPath, url))}" alt="${esc(alt)}" loading="lazy">`;
  });
  // 链接
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label, url) => {
    return `<a href="${esc(url)}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  // 加粗/斜体
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  // 还原行内代码
  out = out.replace(/\x00(\d+)\x00/g, (_, i) => `<code>${codes[+i]}</code>`);
  return out;
}

function fileUrl(skillId, docPath, url) {
  if (/^(https?:|data:)/.test(url)) return url;
  // 相对路径:相对当前文档所在目录解析
  const dir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/') + 1) : '';
  const rel = (dir + url).replace(/^\.\//, '');
  return `/api/skills/${skillId}/file?path=${encodeURIComponent(rel)}`;
}

/* ============ 设置(API key 加密存储 + LLM 预设 + 连通测试) ============ */

async function openSettings() {
  $('settings-modal').hidden = false;
  setStatusLine('test-translate-status', '');
  setStatusLine('test-llm-status', '');
  try {
    await loadSettingsState();
  } catch (err) {
    toast(`设置加载失败:${err.message}`, true);
  }
}

async function loadSettingsState() {
  const st = await api('/api/settings');
  S.settings = st;

  const tk = $('set-translate-key');
  tk.value = '';
  tk.placeholder = st.translate.maskedKey
    ? `已保存:${st.translate.maskedKey}`
    : '输入 API key(留空 = 不变)';
  $('btn-clear-translate').hidden = st.translate.source !== 'store';

  const sel = $('llm-preset');
  sel.innerHTML = st.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.value = st.llm.preset || 'custom';

  const bu = $('llm-baseurl');
  bu.value = st.llm.baseUrl || '';
  const lk = $('llm-key');
  lk.value = '';
  lk.placeholder = st.llm.maskedKey
    ? `已保存:${st.llm.maskedKey}`
    : '输入 API key(留空 = 不变)';
  $('btn-clear-llm').hidden = st.llm.source !== 'store';

  applyPresetSelection();
  // 已保存模型作为选项置顶选中(不在预设列表也保留)
  fillModelOptions(presetOf(st.llm.preset)?.models || [], st.llm.model || '');
}

function presetOf(id) {
  return (S.settings?.presets || []).find((p) => p.id === id) || null;
}

function applyPresetSelection() {
  const p = presetOf($('llm-preset').value);
  const bu = $('llm-baseurl');
  if (p && p.id !== 'custom') {
    bu.value = p.baseUrl;
    bu.readOnly = true;
    fillModelOptions(p.models || []); // 切换预设 = 换服务商,模型重置
  } else {
    bu.readOnly = false;
    if (p) bu.placeholder = 'https://…/v1(OpenAI 兼容)';
    fillModelOptions([]);
  }
}

/** 模型下拉:候选 + "手动输入";extraValue 为已保存/当前值,不在候选时置顶保留 */
function fillModelOptions(models, extraValue) {
  const select = $('llm-model-select');
  const input = $('llm-model-input');
  input.hidden = true;
  select.hidden = false;

  const list = [...new Set([...(extraValue ? [extraValue] : []), ...(models || [])])];
  if (!list.length) {
    select.innerHTML = '<option value="">— 测试连通获取,或手动输入 —</option>' +
      '<option value="__custom__">✎ 手动输入…</option>';
    select.value = '';
    return;
  }
  select.innerHTML = list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('') +
    '<option value="__custom__">✎ 手动输入…</option>';
  select.value = extraValue && list.includes(extraValue) ? extraValue : list[0];
}

function getModelValue() {
  const input = $('llm-model-input');
  if (!input.hidden) return input.value.trim();
  const v = $('llm-model-select').value;
  return v === '__custom__' ? '' : v;
}

function setStatusLine(id, html, cls) {
  const el = $(id);
  el.className = 'status-line' + (cls ? ` ${cls}` : '');
  el.innerHTML = html || '';
}

function currentLlmFields() {
  const presetId = $('llm-preset').value;
  const p = presetOf(presetId);
  return {
    preset: presetId,
    baseUrl: p && p.id !== 'custom' ? p.baseUrl : $('llm-baseurl').value.trim(),
    model: getModelValue(),
    apiKey: $('llm-key').value.trim() || undefined, // 留空 → 后端用已存
  };
}

async function testLlmFromUI() {
  setStatusLine('test-llm-status', '<span class="spin"></span>测试中…');
  $('btn-test-llm').disabled = true;
  try {
    const r = await api('/api/settings/test/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentLlmFields()),
    });
    if (r.ok) {
      const modelsNote = r.models?.length ? `,发现 ${r.models.length} 个模型(已填入下拉)` : '';
      setStatusLine('test-llm-status', `✓ 连通正常,延迟 ${r.latencyMs} ms${modelsNote}`, 'ok');
      if (r.models?.length) fillModelOptions(r.models, getModelValue() || undefined);
    } else {
      setStatusLine('test-llm-status', `✗ ${esc(r.error || '测试失败')}`, 'err');
    }
  } catch (err) {
    setStatusLine('test-llm-status', `✗ ${esc(err.message)}`, 'err');
  } finally {
    $('btn-test-llm').disabled = false;
  }
}

async function testTranslateFromUI(full) {
  setStatusLine('test-translate-status', `<span class="spin"></span>${full ? '完整测试(消耗 4 积分)' : '测试中'}…`);
  const btn = full ? $('btn-test-translate-full') : $('btn-test-translate');
  btn.disabled = true;
  try {
    const r = await api('/api/settings/test/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full, apiKey: $('set-translate-key').value.trim() || undefined }),
    });
    const parts = [];
    parts.push(r.reachable ? '服务可达 ✓' : '服务不可达 ✗');
    if (r.keyAccepted === true) parts.push('key 被接受 ✓');
    if (r.keyAccepted === false) parts.push('key 无效 ✗(401)');
    if (r.full?.ok) parts.push(`真实翻译成功:"${r.full.sample}"`);
    if (r.full && !r.full.ok) parts.push(`完整测试失败:${r.full.error}`);
    if (r.error) parts.push(esc(r.error));
    const ok = r.reachable && r.keyAccepted !== false && !(r.full && !r.full.ok);
    setStatusLine('test-translate-status', parts.join(' · '), ok ? 'ok' : 'err');
  } catch (err) {
    setStatusLine('test-translate-status', `✗ ${esc(err.message)}`, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function clearStoredKey(which) {
  const body = which === 'translate'
    ? { translate: { apiKey: null } }
    : { llm: { apiKey: null } };
  try {
    await api('/api/settings/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // 只反映"已无存储密钥"这一事实,不重置用户正在填写的表单
    S.settings = await api('/api/settings');
    if (which === 'translate') {
      $('set-translate-key').placeholder = '输入 API key(留空 = 不变)';
      $('btn-clear-translate').hidden = true;
    } else {
      $('llm-key').placeholder = '输入 API key(留空 = 不变)';
      $('btn-clear-llm').hidden = true;
    }
    toast('已清除加密存储中的密钥');
  } catch (err) {
    toast(`清除失败:${err.message}`, true);
  }
}

async function saveSettings() {
  const tk = $('set-translate-key').value.trim();
  const lk = $('llm-key').value.trim();
  const llm = currentLlmFields();
  const payload = {
    llm: { preset: llm.preset, baseUrl: llm.baseUrl, model: llm.model },
  };
  if (tk) payload.translate = { apiKey: tk };
  if (lk) payload.llm.apiKey = lk;

  $('settings-save').disabled = true;
  try {
    const r = await api('/api/settings/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    $('settings-modal').hidden = true;
    toast(r.analysisStarted ? '已保存,正在按新配置增量分析…' : '已保存');
    await refreshData();
  } catch (err) {
    toast(`保存失败:${err.message}`, true);
  } finally {
    $('settings-save').disabled = false;
  }
}

/* ============ 信息面板(隐私/积分/配置 随时可回看) ============ */
function toggleInfo() {
  const el = $('info-popover');
  if (!el.hidden) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  renderInfo();
}

function renderInfo() {
  const el = $('info-popover');
  const st = S.status;
  if (!st) return;
  const t = st.state || {};
  const roots = (S.data?.roots || st.config?.roots || []).map((r) => esc(r.label || r.path)).join('、');
  const lastAt = t.lastAnalysis ? new Date(t.lastAnalysis.at).toLocaleString('zh-CN') : '从未';
  const errors = (t.lastAnalysis?.errors || []).map((e) => `<li>${esc(e)}</li>`).join('');
  el.innerHTML = `
    <h3>状态与隐私说明</h3>
    <section>
      <div class="kv"><b>隐私提示</b><span>开启翻译会把所看文档的原文发送到外部服务 uapis.cn(AI 翻译接口)。代码块/命令/路径/环境变量会先摘出、译后回填,不会被翻译改写。</span></div>
      <div class="kv"><b>翻译同意</b><span>${t.consentTranslate ? '<span class="ok-text">已同意</span>' : '<span class="off-text">未同意(仅原文)</span>'}</span></div>
      <div class="kv"><b>积分消耗</b><span>累计 ${t.creditsUsed || 0} 积分 · ${t.apiCalls || 0} 次调用(每次 4 积分)</span></div>
    </section>
    <section id="info-keysource">…</section>
    <section>
      <div class="kv"><b>技能根</b><span>${roots}</span></div>
      <div class="kv"><b>上次分析</b><span>${lastAt}(${t.lastAnalysis?.entities ?? '-'} 技能)</span></div>
    </section>
    ${errors || (t.lastAnalysis?.errors || []).length
      ? `<section><div class="kv"><b>上次警告</b></div>
         ${(t.lastAnalysis?.errors || []).length ? `<ul class="warn-list">${errors}</ul>` : '<div class="off-text">无警告</div>'}
         <button class="btn warn-clear" id="btn-clear-warnings">清除警告</button></section>`
      : ''}
    <section>
      <div class="kv"><b>API key</b><span>网页 ⚙ 设置页保存的密钥以 OS 凭据库 + AES-256-GCM 加密落盘;密钥永不回传浏览器明文。</span></div>
    </section>`;
  const cw = $('btn-clear-warnings');
  if (cw) {
    cw.onclick = async () => {
      try {
        await api('/api/clear-warnings', { method: 'POST', body: '{}' });
        S.status = await api('/api/status'); // 轮询缓存是旧的,先取最新再重渲染
        renderInfo();
      } catch (err) {
        toast(`清除失败:${err.message}`, true);
      }
    };
  }
  // 密钥来源(异步补充)
  api('/api/settings').then((settings) => {
    const box = $('info-keysource');
    if (!box) return;
    const src = (s) => (s === 'store' ? '网页设置(加密存储)' : '<span class="off-text">未配置</span>');
    const kindZh = { dpapi: 'Windows DPAPI + AES-256-GCM', keychain: 'macOS 钥匙串 + AES-256-GCM', 'secret-tool': 'Linux secret-tool + AES-256-GCM', machine: '机器绑定 AES-256-GCM' }[settings.credentialStoreKind] || settings.credentialStoreKind;
    box.innerHTML = `
      <div class="kv"><b>翻译密钥</b><span>${src(settings.translate.source)}${settings.translate.maskedKey ? ' · ' + esc(settings.translate.maskedKey) : ''}</span></div>
      <div class="kv"><b>LLM 密钥</b><span>${src(settings.llm.source)}${settings.llm.maskedKey ? ' · ' + esc(settings.llm.maskedKey) : ''}</span></div>
      <div class="kv"><b>加密存储</b><span>${esc(kindZh)}</span></div>`;
  }).catch(() => {});
}

document.addEventListener('click', (e) => {
  const pop = $('info-popover');
  if (!pop.hidden && !pop.contains(e.target) && e.target !== $('btn-info') && !$('btn-info').contains(e.target)) {
    pop.hidden = true;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('consent-modal').hidden) hideConsent(false);
    else if (!$('settings-modal').hidden) $('settings-modal').hidden = true;
    else if (!$('viewer').hidden) closeViewer();
    else if (!$('info-popover').hidden) $('info-popover').hidden = true;
    return;
  }
  if (isTypingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  const modalOpen = !$('consent-modal').hidden || !$('settings-modal').hidden;
  if (modalOpen) return;
  if (!$('viewer').hidden) {
    if (e.key === '[') { e.preventDefault(); switchDoc(-1); }
    else if (e.key === ']') { e.preventDefault(); switchDoc(1); }
    return;
  }
  if (e.key === '/') { e.preventDefault(); $('search').focus(); $('search').select(); return; }
  if (e.key === 'j' || e.key === 'J') { e.preventDefault(); moveCardFocus(1); return; }
  if (e.key === 'k' || e.key === 'K') { e.preventDefault(); moveCardFocus(-1); return; }
  // ↑↓ 仅在卡片已聚焦时接管(roving),不抢页面滚动
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement?.classList?.contains('card')) {
    e.preventDefault();
    moveCardFocus(e.key === 'ArrowDown' ? 1 : -1);
  }
});

boot();
