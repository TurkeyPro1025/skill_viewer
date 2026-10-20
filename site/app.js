/* Skill 译站官网交互:复制 / 滚动高亮 / FAQ 单开(零依赖) */
(function () {
  "use strict";

  /* 复制按钮:navigator.clipboard,file:// 下回退 execCommand;成功态 1.6s */
  var btn = document.getElementById("copy-btn");
  var cmd = document.getElementById("install-cmd");
  if (btn && cmd) {
    btn.addEventListener("click", function () {
      var text = cmd.innerText;
      var done = function () {
        btn.textContent = "已复制 ✓";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = "复制";
          btn.classList.remove("copied");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); });
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* 忽略 */ }
        ta.remove();
      }
    });
  }

  /* FAQ 同组单开:展开一条时收起其余 */
  var items = document.querySelectorAll(".faq details");
  items.forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (d.open) items.forEach(function (o) { if (o !== d) o.open = false; });
    });
  });


  /* 图标格式降级:SVG 优先,缺图回退同名 PNG,两者皆缺隐藏留空砖(便于后续补图)。
     error 事件不冒泡,用捕获监听统一处理带 data-fallback 的图标。 */
  document.addEventListener("error", function (e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG" || !img.dataset.fallback) return;
    if (img.dataset.fallbackDone) { img.style.display = "none"; return; }
    img.dataset.fallbackDone = "1";
    img.src = img.dataset.fallback;
  }, true);
  /* Agent 清单默认收起:只显示前 12 个,左下角展开/收起 */
  var rootsList = document.getElementById("roots-list");
  var rootsToggle = document.getElementById("roots-toggle");
  if (rootsList && rootsToggle) {
    rootsList.classList.add("collapsed");
    rootsToggle.addEventListener("click", function () {
      var collapsed = rootsList.classList.toggle("collapsed");
      rootsToggle.setAttribute("aria-expanded", String(!collapsed));
      rootsToggle.textContent = collapsed ? "展开全部" : "收起";
    });
  }

  /* 滚动高亮:视口 35% 高度处探测线所在区块,对应导航链接点亮。
     不用 IntersectionObserver:部分 WebView/后台标签页不派发其回调。 */
  var links = Array.prototype.slice.call(document.querySelectorAll(".nav-links a"));
  var pairs = links.map(function (a) {
    var sec = document.querySelector(a.hash);
    return sec ? { a: a, sec: sec } : null;
  }).filter(function (p) { return p; });

  function update() {
    var line = scrollY + innerHeight * 0.35;
    var hit = null;
    pairs.forEach(function (p) {
      if (p.sec.getBoundingClientRect().top + scrollY <= line) hit = p;
    });
    pairs.forEach(function (p) { p.a.classList.toggle("on", p === hit); });
  }

  window.addEventListener("scroll", update, { passive: true });
  update();


  /* ---------- 界面演示(可交互 mock):真实种子数据,无翻译/整理能力 ---------- */
  var SKILLS = [
    {r:"mattpocock/skills",n:"ask-matt",s:"技能路由器：描述你的处境，它推荐本仓库哪个技能或流程最合适。不确定用哪个 Matt 技能时从这里进。",c:["工程流程"]},
    {r:"mattpocock/skills",n:"code-review",s:"沿\"标准\"与\"品味\"两轴审查自某个基点（commit/分支/tag/merge-base）以来的全部变更，输出结构化评审意见。",c:["工程流程","实现与编码"]},
    {r:"mattpocock/skills",n:"codebase-design",s:"深模块设计的共享词汇表：设计或改进模块接口、寻找加深（deepening）机会、决定什么进公共 API。配合 Ousterhout 的设计理念使用。",c:["工程流程","领域建模"]},
    {r:"mattpocock/skills",n:"diagnosing-bugs",s:"硬 bug 与性能回归的诊断循环：建立反馈环→最小化复现→列假设→插桩→修复→回归测试。说\"diagnose\"或\"debug this\"即触发。",c:["调试"]},
    {r:"mattpocock/skills",n:"domain-modeling",s:"构建并锐化项目的领域模型：维护 GLOSSARY.md 术语表、记录 ADR 架构决策，讨论代码库术语时启用。",c:["领域建模"]},
    {r:"mattpocock/skills",n:"grill-with-docs",s:"毫不留情的高压访谈打磨方案或设计，同时把达成的共识落成 ADR 与术语表文档——访谈即文档化。",c:["工程流程","领域建模"]},
    {r:"mattpocock/skills",n:"implement",s:"按一份 spec 或一组工单实现一段工作，遵守既有测试与代码规范。",c:["实现与编码"]},
    {r:"mattpocock/skills",n:"implement-spec",s:"接续 /to-spec 与 /to-tickets 的产出到代码实现，用并行子代理加速。",c:["实现与编码"]},
    {r:"mattpocock/skills",n:"improve-codebase-architecture",s:"扫描代码库寻找模块加深机会，输出可视化 HTML 报告，选定一项后逐条深挖实施。",c:["工程流程","实现与编码"]},
    {r:"mattpocock/skills",n:"pr",s:"编写 PR 描述文：把一组变更组织成审阅者友好的 PR body。（创作上游：Humanlayer 的 show-me 技能）",c:["工程流程"]},
    {r:"mattpocock/skills",n:"prototype",s:"用一次性原型回答设计问题：验证状态模型或逻辑是否顺手，探索后即弃，不污染正式代码。",c:["实现与编码"]},
    {r:"mattpocock/skills",n:"research",s:"基于高可信原始来源（官方文档/论文/源码）的带引用调研，结论沉淀为仓库内 Markdown 文件。",c:["调研"]},
    {r:"mattpocock/skills",n:"retro",s:"对一次编码会话做复盘：什么有效、什么该改进，沉淀环境改进建议。",c:["工程流程"]},
    {r:"mattpocock/skills",n:"setup-matt-pocock-skills",s:"一次性配置仓库以使用本套工程技能：初始化 issue tracker、分诊标签词汇与文档目录布局。",c:["项目配置"]},
    {r:"mattpocock/skills",n:"tdd",s:"测试驱动开发：红-绿-重构循环，提到 red-green-refactor 或要求集成测试时启用。",c:["测试","实现与编码"]},
    {r:"mattpocock/skills",n:"to-spec",s:"把当前会话综合成一份 spec 并发布到项目 issue tracker——不做访谈，只做已有讨论的合成。",c:["规格与工单"]},
    {r:"mattpocock/skills",n:"to-tickets",s:"把方案/规格/会话拆成一组 tracer-bullet 工单，每张声明自己的阻塞边，发布到配置的 tracker。",c:["规格与工单"]},
    {r:"mattpocock/skills",n:"triage",s:"issue 与外部 PR 的分诊状态机：归类、验证可复现、必要时深挖，产出代理可直接执行的简报。",c:["工程流程"]},
    {r:"mattpocock/skills",n:"wayfinder",s:"把超出单个会话容量的大块工作规划成 issue tracker 上的决策工单共享地图，一次解决一张。",c:["规格与工单","工程流程"]},
    {r:"mattpocock/skills",n:"wizard",s:"生成交互式 bash 向导，带你逐步完成只有本人能做的操作：开通服务、配置密钥、提供凭据等。",c:["项目配置"]},
    {r:"mattpocock/skills",n:"chief-of-staff",s:"在单个会话内协调多个子代理推进一个长期目标，自己当参谋长分派与汇总。",c:["会话管理"]},
    {r:"mattpocock/skills",n:"claude-handoff",s:"把当前对话无缝移交给一个全新的后台代理，新代理立刻接手继续干活。",c:["会话管理"]},
    {r:"mattpocock/skills",n:"loop-me",s:"围绕你想在这个工作区构建的工作流反复深挖规格，直到说清楚为止。",c:["规格与工单"]},
    {r:"mattpocock/skills",n:"setup-ts-deep-modules",s:"接入 dependency-cruiser 让 TypeScript 仓库的每个包都成为深模块：实现藏进子目录，只经公共入口访问。",c:["项目配置","前端开发"]},
    {r:"mattpocock/skills",n:"writing-beats",s:"写作展开：把原始素材组织成\"节拍\"(beats)的旅程，每个术语在节拍依赖它之前先落地。",c:["写作"]},
    {r:"mattpocock/skills",n:"writing-fragments",s:"写作探索：只管挖掘原始碎片，先不谈结构，为后续 beats/shape 积攒原料。",c:["写作"]},
    {r:"mattpocock/skills",n:"writing-shape",s:"写作成形：把原始素材逐段塑造成一篇完整文章。",c:["写作"]},
    {r:"mattpocock/skills",n:"git-guardrails-claude-code",s:"配置 Claude Code hooks，在危险 git 命令（push、reset --hard、clean、branch -D 等）执行前拦下确认。",c:["项目配置"]},
    {r:"mattpocock/skills",n:"migrate-to-shoehorn",s:"把测试文件里的 as 类型断言批量迁移到 @total-typescript/shoehorn。",c:["实现与编码","测试"]},
    {r:"mattpocock/skills",n:"scaffold-exercises",s:"创建练习目录结构：分节、问题、解答、讲解文本，全部通过 lint 检查。",c:["教学材料"]},
    {r:"mattpocock/skills",n:"setup-pre-commit",s:"为当前仓库配置 Husky pre-commit 钩子：lint-staged(Prettier)、类型检查与测试。",c:["项目配置"]},
    {r:"mattpocock/skills",n:"grill-me",s:"一场毫不留情的访谈，穷追猛打地打磨你的计划或设计。",c:["沟通模式"]},
    {r:"mattpocock/skills",n:"grilling",s:"高压追问模式：压力测试你的计划、决策或想法，任何 grill 触发词都可用。",c:["沟通模式"]},
    {r:"mattpocock/skills",n:"handoff",s:"把当前会话压缩成一份交接文档，让下一个代理（或明天的你）无缝接手。",c:["会话管理"]},
    {r:"mattpocock/skills",n:"teach",s:"在当前工作区内教会你一项新技能或概念，结合你的真实代码讲解。",c:["教学材料"]},
    {r:"mattpocock/skills",n:"to-questionnaire",s:"把你没法独立回答的决策转成一份给别人填的问卷，把缺口变成问题。",c:["沟通模式","规格与工单"]},
    {r:"mattpocock/skills",n:"wait-what",s:"\"停，刚才那条没讲明白\"——让模型换个方式重新表述上一条消息。",c:["沟通模式"]},
    {r:"mattpocock/skills",n:"writing-for-agents",s:"为代理写文档：编写或修改 skills、AGENTS.md、CLAUDE.md，让下一次调用更准。",c:["写作"]},
    {r:"nextlevelbuilder/ui-ux-pro-max-skill",n:"ui-ux-pro-max",s:"UI/UX 设计智能引擎主技能：本地可搜索 79 种 UI 风格（50 激活）、192 套配色与推理档案、74 组字体搭配、119 条 UX 准则、105 图标、17 个 GSAP 动效预设、25 种图表、22 个技术栈。设计/构建/审查/修复界面，含无障碍、响应式、排版、配色、图表。",c:["设计智能","前端开发"]},
    {r:"nextlevelbuilder/ui-ux-pro-max-skill",n:"design",s:"综合设计技能：品牌识别、设计令牌、UI 样式、Logo 生成（55 种风格，支持 Gemini/Atlas Cloud/MuAPI 等 AI 服务）、企业形象设计。",c:["设计智能","品牌视觉"]},
    {r:"nextlevelbuilder/ui-ux-pro-max-skill",n:"design-system",s:"设计令牌架构与组件规范：基础→语义→组件三层令牌、CSS 变量、间距与排版体系，并可生成幻灯片。",c:["设计系统","前端开发"]},
    {r:"nextlevelbuilder/ui-ux-pro-max-skill",n:"ui-styling",s:"用 shadcn/ui(Radix UI + Tailwind)、Tailwind 工具类与 canvas 构建美观且可访问的用户界面。",c:["前端开发","设计系统"]},
    {r:"nextlevelbuilder/ui-ux-pro-max-skill",n:"brand",s:"品牌工作台：品牌声音、视觉识别、信息框架、资产管理与一致性检查，产出品牌化内容时启用。",c:["品牌视觉"]},
    {r:"nextlevelbuilder/ui-ux-pro-max-skill",n:"banner-design",s:"横幅与主视觉设计：社交媒体、广告、网站 hero、印刷品，一次给多个艺术方向方案，可接入生成或用户提供的素材。",c:["品牌视觉","设计智能"]},
    {r:"nextlevelbuilder/ui-ux-pro-max-skill",n:"slides",s:"策略性 HTML 演示文稿：Chart.js 图表、设计令牌、响应式布局、文案公式与分场景幻灯片策略。",c:["演示文稿"]},
    {r:"vercel-labs/skills",n:"find-skills",s:"技能发现与安装助手：问\"怎么做 X\"\"有没有能…的技能\"时，帮你搜索并安装合适的 agent skills。",c:["工程流程"]},
    {r:"alibaba-flyai/flyai-skill",n:"flyai",s:"用自然语言搜机票、酒店、景点、演出与旅行特价：连接 Fliggy MCP 实时检索与预订。",c:["旅行生活"]}
  ];

  var mockState = { q: "", cat: null, repo: null };
  var mockEl = {
    q: document.getElementById("mock-q"),
    chips: document.getElementById("mock-chips"),
    tree: document.getElementById("mock-tree"),
    cards: document.getElementById("mock-cards"),
    status: document.getElementById("mock-status")
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function mockRepos() {
    var seen = {};
    SKILLS.forEach(function (s) { seen[s.r] = 1; });
    return Object.keys(seen);
  }

  function mockFiltered() {
    var q = mockState.q.trim().toLowerCase();
    return SKILLS.filter(function (s) {
      if (mockState.cat && s.c.indexOf(mockState.cat) === -1) return false;
      if (mockState.repo && s.r !== mockState.repo) return false;
      if (!q) return true;
      return (s.n + " " + s.s + " " + s.c.join(" ")).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderChips() {
    var counts = {};
    SKILLS.forEach(function (s) { s.c.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    var cats = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var html = mockChip("", "全部", SKILLS.length);
    cats.forEach(function (c) { html += mockChip(c, c, counts[c]); });
    mockEl.chips.innerHTML = html;
  }

  function mockChip(val, label, n) {
    var on = (mockState.cat || null) === (val || null);
    return '<button type="button" class="mchip' + (on ? " on" : "") + '" data-cat="' + esc(val) + '" aria-pressed="' + on + '">' + esc(label) + " <small>" + n + "</small></button>";
  }

  function renderTree() {
    var counts = {};
    SKILLS.forEach(function (s) { counts[s.r] = (counts[s.r] || 0) + 1; });
    var repos = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    mockEl.tree.innerHTML = repos.map(function (r) {
      var on = mockState.repo === r;
      var html = '<button type="button" class="mtree-repo' + (on ? " on" : "") + '" data-repo="' + esc(r) + '" aria-pressed="' + on + '"><span class="caret">' + (on ? "▾" : "▸") + "</span> " + esc(r) + " <small>(" + counts[r] + ")</small></button>";
      if (on) {
        html += '<ul class="mtree-items">';
        SKILLS.filter(function (s) { return s.r === r; }).forEach(function (s) {
          html += '<li><button type="button" class="mtree-item" data-skill="' + esc(s.n) + '">' + esc(s.n) + "</button></li>";
        });
        html += "</ul>";
      }
      return html;
    }).join("");
  }

  function renderCards() {
    var list = mockFiltered();
    if (!list.length) {
      mockEl.cards.innerHTML = '<p class="mock-empty">没有匹配的技能——清除搜索词或分类筛选再试试。</p>';
    } else {
      mockEl.cards.innerHTML = list.map(function (s) {
        var tags = s.c.map(function (c) {
          return '<button type="button" class="mcard-tag" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
        }).join("");
        return '<article class="mcard" data-skill="' + esc(s.n) + '">' +
          '<div class="mcard-head"><code class="mcard-name">' + esc(s.n) + '</code><span class="mcard-repo">' + esc(s.r) + "</span></div>" +
          '<p class="mcard-sum">' + esc(s.s) + "</p>" +
          '<div class="mcard-tags">' + tags + "</div></article>";
      }).join("");
    }
    mockEl.status.textContent = "筛选 " + list.length + " / " + SKILLS.length + " 个技能 · " + mockRepos().length + " 个仓库 · 演示数据，翻译与归属整理在完整版中";
  }

  function renderMock() { renderChips(); renderTree(); renderCards(); }

  if (mockEl.chips) {
    renderMock();
    mockEl.q.addEventListener("input", function () {
      mockState.q = mockEl.q.value;
      renderCards();
    });
    mockEl.chips.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-cat]");
      if (!btn) return;
      var v = btn.getAttribute("data-cat") || null;
      mockState.cat = mockState.cat === v ? null : v; /* 再点一次取消 */
      renderMock();
    });
    mockEl.tree.addEventListener("click", function (e) {
      var item = e.target.closest("[data-skill]");
      if (item) {
        var card = mockEl.cards.querySelector('[data-skill="' + CSS.escape(item.getAttribute("data-skill")) + '"]');
        if (card) {
          card.scrollIntoView({ block: "nearest", behavior: "smooth" });
          card.classList.remove("flash");
          void card.offsetWidth;
          card.classList.add("flash");
        }
        return;
      }
      var repoBtn = e.target.closest("[data-repo]");
      if (!repoBtn) return;
      var r = repoBtn.getAttribute("data-repo");
      mockState.repo = mockState.repo === r ? null : r; /* 再点一次收起 */
      renderMock();
    });
    mockEl.cards.addEventListener("click", function (e) {
      var tag = e.target.closest(".mcard-tag[data-cat]");
      if (!tag) return;
      var v = tag.getAttribute("data-cat") || null;
      mockState.cat = mockState.cat === v ? null : v;
      renderMock();
    });
  }
})();
