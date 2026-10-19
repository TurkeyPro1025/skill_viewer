'use strict';

/* global document, fetch, window, localStorage, encodeURIComponent, setTimeout */

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

/* ============ 外观(密度;主题固定浅色,仅本机 localStorage) ============ */
const APPEARANCE_KEY = 'skill-viewer:appearance';

function loadAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}');
    const density = saved.density === 'compact' ? 'compact' : 'comfortable';
    return { density };
  } catch {
    return { density: 'comfortable' };
  }
}

function saveAppearance() {
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(S.appearance)); } catch { /* 隐私模式等场景静默 */ }
}

function applyAppearance() {
  document.documentElement.dataset.theme = 'light'; // 主题固定浅色
  document.documentElement.dataset.density = S.appearance.density;
  document.querySelectorAll('input[name="density"]').forEach((r) => {
    r.checked = r.value === S.appearance.density;
  });
}

/* 内联图标(fill=currentColor,颜色随文字):外链跳转 / 链接标记 */
const ICO_DUMP_TO = '<svg class="ico-svg" viewBox="0 0 1024 1024" aria-hidden="true"><path d="M831.875 960.01H63.99V192.125h351.948a31.995 31.995 0 0 0 31.995-31.996 31.995 31.995 0 0 0-31.995-31.995H63.99A63.99 63.99 0 0 0 0 192.124V960.01A63.99 63.99 0 0 0 63.99 1024h767.885a63.99 63.99 0 0 0 63.99-63.99V608.062a31.995 31.995 0 0 0-31.994-31.995 31.995 31.995 0 0 0-31.996 31.995z" fill="currentColor"/><path d="M1023.847 25.75c0-0.896 0-1.792-0.768-2.688a31.611 31.611 0 0 0-1.024-3.327 31.74 31.74 0 0 0-1.536-3.072c0-0.768-0.768-1.664-1.408-2.432a32.123 32.123 0 0 0-8.83-8.83l-3.072-1.152-3.071-1.664-3.328-1.024-2.56-1.408a32.123 32.123 0 0 0-6.27 0H544.045a31.995 31.995 0 0 0-32.123 31.996 31.995 31.995 0 0 0 31.995 31.995h371.145L361.29 617.404a31.995 31.995 0 1 0 45.305 45.306l553.261-553.26v371.143a31.995 31.995 0 0 0 31.995 31.484 31.995 31.995 0 0 0 31.996-31.995V32.149a32.123 32.123 0 0 0 0-6.4z" fill="currentColor"/></svg>';
const ICO_LINK = '<svg class="ico-svg" viewBox="0 0 1024 1024" aria-hidden="true"><path d="M762.24 506.88a32 32 0 0 1-46.08-44.16l55.68-58.24a125.76 125.76 0 0 0-12.16-171.2c-48.32-50.24-119.68-54.72-160-12.48L444.16 384a125.76 125.76 0 0 0 12.16 171.2 32 32 0 0 1 0 45.12 32 32 0 0 1-45.44 0 189.44 189.44 0 0 1-12.16-259.52l155.52-162.24c66.88-69.76 180.48-64 252.8 12.8A189.44 189.44 0 0 1 818.24 448z" fill="currentColor"/><path d="M229.76 517.12a32 32 0 0 1 46.08 44.16l-55.68 58.24a125.76 125.76 0 0 0 12.16 171.2c48.32 50.24 119.68 54.72 160 12.48L547.84 640a125.76 125.76 0 0 0-12.16-171.2 32 32 0 0 1 0-45.12 32 32 0 0 1 45.44 0 189.44 189.44 0 0 1 12.16 259.52L437.76 845.44c-66.88 69.76-180.48 64-252.8-12.8A189.44 189.44 0 0 1 173.76 576z" fill="currentColor"/></svg>';

/* 根目录徽章:已知工具上品牌特征色(CSS .root-<slug> 定义);名单外的
   非主流 agent 散列到 10 色冗余池(CSS root-auto0..9),同一目录颜色稳定。 */
const KNOWN_ROOT_SLUGS = new Set([
  'agents', // 主色调(主题强调色,CSS 缺省)
  // 国际
  'claude', 'copilot', 'gemini', 'windsurf', 'opencode', 'crush', 'aider',
  'zed', 'kiro', 'roo', 'continue', 'droid', 'factory', 'amp',
  'codex', 'cursor', 'goose', 'kimi', 'cline',
  // 国内
  'zcode', 'zai', 'zhipu', 'codegeex', 'deepseek', 'qwen', 'qoder',
  'codebuddy', 'comate', 'trae', 'marscode',
]);
const ROOT_AUTO_COLORS = 10;

function rootBadgeClass(label) {
  const slug = String(label || '').replace(/^\./, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!slug) return '';
  if (KNOWN_ROOT_SLUGS.has(slug)) return ` root-${slug}`;
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return ` root-auto${h % ROOT_AUTO_COLORS}`;
}

/* ============ 初始化 ============ */
async function boot() {
  S.appearance = loadAppearance();
  applyAppearance();
  document.querySelectorAll('input[name="density"]').forEach((r) => {
    r.addEventListener('change', () => {
      S.appearance.density = r.value;
      saveAppearance();
      applyAppearance();
      renderGroups(); // 密度改变卡片宽度,根徽章需重新适配
    });
  });
  // 窗口宽度变化同样影响一行能放下几个徽章
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (S.data) renderGroups(); }, 150);
  });
  // 读数条「待确认推断」:直达整理归属,展开低置信度折叠区
  $('st-infer').addEventListener('click', () => {
    if (!S.selectMode) toggleSelectMode(true);
    document.querySelectorAll('details.subgroup.lowconf').forEach((d) => { d.open = true; });
    document.querySelector('details.subgroup.lowconf')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  $('search').addEventListener('input', (e) => { S.q = e.target.value.trim(); renderGroups(); });
  $('btn-update').addEventListener('click', manualUpdate);
  $('btn-organize').addEventListener('click', toggleSelectMode);
  $('btn-info').addEventListener('click', toggleInfo);
  $('btn-cancel-select').addEventListener('click', () => toggleSelectMode(false));
  $('btn-assign').addEventListener('click', () => assignSelection($('repo-select').value));
  $('repo-select').addEventListener('change', () => { $('btn-assign').disabled = !$('repo-select').value; });
  // 模型选择器(可搜索下拉:纯选择,不允许可自由输入)
  initModelPicker();
  $('btn-unknown').addEventListener('click', () => assignSelection(''));
  $('btn-confirm').addEventListener('click', confirmInference);
  $('viewer-close').addEventListener('click', closeViewer);
  $('consent-cancel').addEventListener('click', () => hideConsent(false));
  $('consent-accept').addEventListener('click', () => hideConsent(true));
  $('btn-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => { $('settings-modal').hidden = true; });
  $('settings-save').addEventListener('click', saveSettings);
  $('llm-preset').addEventListener('change', () => applyPresetSelection(true));
  $('btn-test-translate').addEventListener('click', () => testTranslateFromUI(false));
  $('btn-test-translate-full').addEventListener('click', () => testTranslateFromUI(true));
  $('btn-test-llm').addEventListener('click', testLlmFromUI);
  $('btn-clear-translate').addEventListener('click', () => clearStoredKey('translate'));
  $('btn-clear-llm').addEventListener('click', () => clearStoredKey('llm'));
  // 桌面设置(托盘/自启):即时生效,不依赖「保存」按钮
  $('set-autostart').addEventListener('change', saveDesktopSettings);
  $('set-close-exit').addEventListener('change', saveDesktopSettings);

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
    $('stats-bar').hidden = false;
    $('stats-line').hidden = false;
    $('stats-line').textContent = err.code === 'no_index'
      ? '首次分析进行中…'
      : `加载失败:${err.message}`;
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
  $('stats-bar').hidden = false;
  $('stats-line').hidden = true;
  $('st-skills').textContent = d.stats.entities;
  $('st-repos').textContent = groupCount;
  $('st-attr').textContent = d.stats.attributed;
  const infer = d.stats.inferred || 0;
  $('st-infer').hidden = infer === 0;
  $('st-infer').querySelector('b').textContent = infer;
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
    head.onclick = (e) => {
      // 仓库描述是纯表述文字:点击不折叠;用户正在划选文本时也不折叠(松手 click 落在头部会误收起)
      if (e.target.closest('.group-summary')) return;
      const sel = window.getSelection();
      if (sel && sel.type === 'Range') return;
      if (S.collapsed.has(group.key)) S.collapsed.delete(group.key); else S.collapsed.add(group.key);
      renderGroups();
    };
    const ghBtn = group.sourceUrl
      ? `<a class="gh-link" href="${esc(group.sourceUrl)}" target="_blank" rel="noreferrer" title="在 GitHub 打开 ${esc(group.name)}" onclick="event.stopPropagation()">${ICO_DUMP_TO}<span>GitHub</span></a>`
      : '';
    head.innerHTML = `
      <span class="caret">▼</span>
      <span class="group-title">${esc(group.name)}</span>
      ${ghBtn}
      <span class="group-count">${visible} 技能</span>
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
  const filtering = Boolean(S.q || S.cat);
  if (filtering) {
    $('st-match').hidden = false;
    $('st-match-n').textContent = visibleTotal;
    $('st-match-label').textContent = `/ ${S.data.stats.entities} 匹配`;
    $('empty-hint').textContent = S.q
      ? '按 Ctrl+K 回到搜索,试试更短的关键词'
      : '点击上方高亮的分类胶囊可取消筛选';
  } else {
    $('st-match').hidden = true;
    $('empty-hint').textContent = '';
  }
  // 卡片已入文档:测量并折叠溢出的根徽章
  document.querySelectorAll('#groups .badges').forEach(fitRootBadges);
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

/**
 * 根徽章一行适配:逐个隐藏换行到第二行的根徽章、折进「+N」,
 * 直到根徽章(+N)都在第一行;被隐藏的挪进 +N 的悬浮层。
 * 需在卡片已插入文档后调用(依赖 offsetTop 测量)。
 */
function fitRootBadges(badgesEl) {
  const more = badgesEl.querySelector(':scope > .badge-more');
  if (!more) return;
  const roots = [...badgesEl.querySelectorAll(':scope > .badge-root:not(.badge-more)')];
  const flyout = more.querySelector('.badge-flyout');
  const hidden = () => roots.filter((r) => r.style.display === 'none');
  const hide = (el) => { el.style.display = 'none'; };
  more.style.display = 'none';
  if (roots.length < 2) return;

  let guard = 16;
  while (guard--) {
    const visible = roots.filter((r) => r.style.display !== 'none');
    if (visible.length <= 1) break;
    const firstTop = visible[0].offsetTop;
    const overflow = visible.filter((r) => r.offsetTop !== firstTop);
    if (!overflow.length) break;
    hide(overflow[overflow.length - 1]);
    more.style.display = '';
    more.querySelector('.badge-more-n').textContent = hidden().length;
  }
  // +N 自身掉到第二行时,继续收一个
  while (more.style.display !== 'none' && guard-- > 0) {
    const visible = roots.filter((r) => r.style.display !== 'none');
    if (visible.length <= 1 || more.offsetTop === visible[0].offsetTop) break;
    hide(visible[visible.length - 1]);
    more.querySelector('.badge-more-n').textContent = hidden().length;
  }
  // 全被折叠(极端窄卡)→ 放弃折叠,全部展示
  if (!roots.some((r) => r.style.display !== 'none')) {
    roots.forEach((r) => { r.style.display = ''; });
    more.style.display = 'none';
    return;
  }
  for (const r of hidden()) {
    r.style.display = '';
    flyout.appendChild(r);
  }
}

function cardEl(card) {
  const el = document.createElement('div');
  el.className = 'card' + (S.selectMode ? ' selecting' : '') + (S.selection.has(card.id) ? ' selected' : '');

  const badges = [];
  const roots = card.roots || [];
  for (const r of roots) {
    badges.push(`<span class="badge badge-root${r.linked ? ' linked' : ''}${rootBadgeClass(r.label)}" title="${r.linked ? '链接到该工具根目录' : '实体所在根目录'}">${esc(r.label)}${r.linked ? ICO_LINK : ''}</span>`);
  }
  // 根徽章排满一行才折叠为「+N」(渲染后由 fitRootBadges 测量);悬停 +N 弹出剩余徽章
  if (roots.length >= 2) {
    badges.push('<span class="badge badge-root badge-more" title="其余生效的根目录">+<span class="badge-more-n"></span><span class="badge-flyout"></span></span>');
  }
  if (card.copyCount > 1) badges.push(`<span class="badge badge-copy" title="内容一致的独立拷贝已合并">${card.copyCount} 份拷贝已合并</span>`);
  const a = card.attribution;
  if (a) {
    // 创作上游紧随根目录徽章:一行放得下就同行,放不下自然换行
    if (a.upstream) badges.push(`<span class="badge badge-upstream" title="frontmatter 记录的创作上游(非安装来源)">创作上游:${esc(a.upstream.repo)}</span>`);
    if (a.inferred && !a.confirmed) {
      badges.push(`<span class="badge badge-infer">推断${a.confidence ? ' · ' + esc(confZh(a.confidence)) : ''} → ${esc(a.repo)}</span>`);
    } else if (a.inferred && a.confirmed) {
      badges.push(`<span class="badge badge-confirm" title="你已确认此推断">已确认推断</span>`);
    }
    if (a.method === 'overrides') badges.push('<span class="badge badge-confirm" title="手动归组">手动</span>');
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
  attachCodeCopy(col);
}

/** 代码块悬停复制按钮(原文代码块;译文侧代码块本就不翻译,共用同一实现) */
function attachCodeCopy(root) {
  root.querySelectorAll('.md pre').forEach((pre) => {
    if (pre.querySelector('.code-copy')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy';
    btn.type = 'button';
    btn.textContent = '复制';
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? pre.textContent);
        btn.textContent = '已复制';
      } catch {
        btn.textContent = '复制失败';
      }
      btn.disabled = true;
      setTimeout(() => { btn.textContent = '复制'; btn.disabled = false; }, 1500);
    };
    pre.appendChild(btn);
  });
}

function renderBilingual(doc, translation) {
  const tmap = new Map((translation?.blocks || []).map((b) => [b.id, b]));
  const failed = [...tmap.values()].some((b) => b.status === 'failed');
  const cached = Boolean(translation?.cached);
  $('viewer-meta').innerHTML =
    (cached ? '<span class="badge badge-confirm">已缓存 · 0 积分</span>' : '') +
    (failed ? '<button class="btn" id="btn-retry-doc">重试失败块</button>' : '');

  const retryBtn = $('btn-retry-doc');
  if (retryBtn) retryBtn.onclick = () => fetchTranslation({ retry: true });

  const box = $('viewer-content');
  // 列头固定在滚动区外(结构性置顶),.bilingual 才是滚动元素
  box.innerHTML = '<div class="bilingual-head"><span>原文</span><span>译文</span></div><div class="bilingual"></div>';
  const wrap = box.querySelector('.bilingual');
  const skillId = S.viewer.skill.id;

  for (const b of doc.blocks) {
    const row = document.createElement('div');
    if (b.type === 'code' || b.type === 'hr') {
      row.className = 'brow full';
      row.innerHTML = `<div class="md">${renderBlockMarkdown(b, skillId, doc.path)}</div>`;
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
  attachCodeCopy(wrap);
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

  // 桌面模式:显示「桌面」设置区并填充当前值
  const desktop = Boolean(S.status?.config?.desktop);
  $('desktop-section').hidden = !desktop;
  if (desktop) {
    try {
      const ds = await api('/api/desktop-settings');
      $('set-autostart').checked = Boolean(ds.autostart);
      $('set-close-exit').checked = Boolean(ds.closeToExit);
    } catch { /* 保持默认值 */ }
  }

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

  S.savedModelId = st.llm.model || '';
  S.modelValue = st.llm.model || '';
  applyPresetSelection(false); // 打开弹窗:不自动覆盖已存的 API 地址
}

function presetOf(id) {
  return (S.settings?.presets || []).find((p) => p.id === id) || null;
}

/* ---- 模型选择器:可搜索下拉;候选按服务商(预设|地址)隔离,显示 name、提交 id ---- */

/** 当前服务商标识:同一服务商的拉取结果互通,跨服务商互不混入 */
function providerKey() {
  return `${$('llm-preset').value}|${$('llm-baseurl').value.trim()}`;
}

/** 当前候选:该服务商「测试连通」拉取过 → 整体替换为拉取结果;否则 = 已保存模型 + 预设自带 */
function currentCandidates() {
  const fetched = S.fetchedModels?.get(providerKey()) || [];
  if (fetched.length) {
    return fetched
      .filter((it) => it && typeof it.id === 'string' && it.id)
      .map((it) => ({ id: it.id, name: typeof it.name === 'string' && it.name ? it.name : null }));
  }
  const items = [];
  const push = (id, name) => {
    if (id && !items.some((x) => x.id === id)) items.push({ id, name: name || null });
  };
  push(S.savedModelId); // 已保存模型排最前,保证「记忆默认值」始终可选
  (presetOf($('llm-preset').value)?.models || []).forEach((m) => push(m));
  return items;
}

function modelLabelOf(id) {
  const it = (S.modelItems || []).find((x) => x.id === id);
  return it ? (it.name || it.id) : (id || '');
}

/** 按当前服务商重算候选并回显;列表展开中则同步重绘(否则已展开的旧内容/空态不会消失)。默认值 = 已保存模型(记忆)在候选里则用它,否则取第一个候选 */
function refreshModelOptions() {
  S.modelItems = currentCandidates();
  S.modelValue = S.modelItems.some((it) => it.id === S.savedModelId)
    ? S.savedModelId
    : (S.modelItems[0]?.id || '');
  $('llm-model-search').value = modelLabelOf(S.modelValue);
  const list = document.querySelector('#llm-model-picker .model-picker-list');
  if (list && !list.hidden) renderModelList(true, '');
}

function applyPresetSelection(fromUser) {
  const p = presetOf($('llm-preset').value);
  const bu = $('llm-baseurl');
  bu.readOnly = false; // 预设也开放修改(如自建中转站换地址)
  if (p && p.id !== 'custom') {
    // 用户主动切换 → 自动填充预设地址;打开弹窗 → 仅地址为空时补默认,不覆盖已存的中转站地址
    if (fromUser || !bu.value.trim()) bu.value = p.baseUrl;
  } else if (p) {
    bu.placeholder = 'https://…/v1(OpenAI 兼容,可填中转站地址)';
  }
  // 切服务商 = 候选切到该服务商自己的(拉取过 → 拉取结果整体替换;否则 预设 + 已存);API key 不受影响
  refreshModelOptions();
}

/** 渲染候选列表;query 为过滤词(与输入框回显的已选模型名解耦)。显示 name,提交 id。 */
function renderModelList(show, query) {
  const list = document.querySelector('#llm-model-picker .model-picker-list');
  const input = $('llm-model-search');
  const q = (query ?? '').trim().toLowerCase();
  const hits = (S.modelItems || []).filter((it) =>
    !q || it.id.toLowerCase().includes(q) || (it.name || '').toLowerCase().includes(q));
  list.innerHTML = '';
  if (!hits.length) {
    const empty = document.createElement('div');
    empty.className = 'model-picker-empty';
    empty.textContent = S.modelItems.length ? '无匹配模型' : '尚无候选:点上方「测试连通」自动拉取';
    list.appendChild(empty);
  } else {
    for (const it of hits) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-picker-item' + (it.id === S.modelValue ? ' on' : '');
      item.textContent = it.name || it.id;
      item.title = it.name && it.name !== it.id ? `${it.name} · ${it.id}` : it.id;
      item.onmousedown = (e) => e.preventDefault(); // 不抢 blur,先让点击落地
      item.onclick = () => {
        S.modelValue = it.id;
        input.value = it.name || it.id;
        list.hidden = true;
      };
      list.appendChild(item);
    }
  }
  list.hidden = !show;
}

function initModelPicker() {
  S.modelItems = [];
  S.modelValue = '';
  S.savedModelId = '';
  S.fetchedModels = new Map(); // providerKey → 该服务商「测试连通」拉取的模型项
  const input = $('llm-model-search');
  const list = document.querySelector('#llm-model-picker .model-picker-list');
  // 聚焦:全量展示候选(过滤词清空),并全选已选文本——键入即过滤
  input.addEventListener('focus', () => {
    input.select();
    renderModelList(true, '');
  });
  input.addEventListener('input', () => renderModelList(true, input.value));
  // 失焦收起列表,输入框回显已选模型名(敲入的只是过滤词,不是值)
  input.addEventListener('blur', () => setTimeout(() => {
    list.hidden = true;
    input.value = modelLabelOf(S.modelValue);
  }, 150));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#llm-model-picker')) list.hidden = true;
  });
}

function getModelValue() {
  return S.modelValue || '';
}

function setStatusLine(id, html, cls) {
  const el = $(id);
  el.className = 'status-line' + (cls ? ` ${cls}` : '');
  el.innerHTML = html || '';
}

/** 桌面设置(开机自启 / 关闭即退出):写入后端即时生效 */
async function saveDesktopSettings() {
  try {
    await api('/api/desktop-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autostart: $('set-autostart').checked,
        closeToExit: $('set-close-exit').checked,
      }),
    });
    toast('桌面设置已生效');
  } catch (err) {
    toast(`桌面设置保存失败:${err.message}`, true);
  }
}

function currentLlmFields() {
  const presetId = $('llm-preset').value;
  const p = presetOf(presetId);
  return {
    preset: presetId,
    baseUrl: $('llm-baseurl').value.trim(),
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
      const modelsNote = r.models?.length ? `,发现 ${r.models.length} 个模型(下拉已更新)` : '';
      setStatusLine('test-llm-status', `✓ 连通正常,延迟 ${r.latencyMs} ms${modelsNote}`, 'ok');
      if (r.models?.length) {
        // 后端两种返回都归一为 {id,name}:旧版进程返回字符串数组 ['id',…],新版返回 [{id,name}]
        // (常驻服务不热重载,前端必须兼容运行中进程的旧结构,否则 id 取不到、候选被滤空)
        const norm = r.models
          .map((m) => (typeof m === 'string' ? { id: m, name: null } : m))
          .filter((m) => m && typeof m.id === 'string' && m.id)
          .map((m) => ({ id: m.id, name: typeof m.name === 'string' && m.name ? m.name : null }));
        if (norm.length) {
          // 拉取结果挂在当前服务商名下,整体替换该服务商的候选,不混入别家
          S.fetchedModels.set(providerKey(), norm);
          refreshModelOptions(); // 重算候选 + 回显;展开中的列表同步重绘,点开输入框也始终是最新
        }
      }
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
  // 唯一快捷键:Ctrl+K 聚焦搜索框
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    const search = $('search');
    search.focus();
    search.select();
  }
});

boot();
