/* Skills 译站官网 · 交互演示(零依赖,不发任何网络请求)
   交互逻辑裁剪移植自 public/app.js:搜索、分类 chips、分组卡片、
   原文/译文对照阅读器与 Markdown 渲染;演示数据内联,块格式 [id, type, 原文, 译文|null]。 */
(function () {
  "use strict";

  /* 官网双语页共用同一份脚本:按 <html lang> 选界面文案;演示数据保持中英对照原貌 */
  var IS_EN = (document.documentElement.lang || "").toLowerCase().indexOf("en") === 0;
  var T = IS_EN
    ? {
        skills: "skills",
        openOnGitHub: "Open on GitHub",
        openSkill: function (name) { return "Open " + name + " — original and translation"; },
        linkedRoot: "Linked to this tool root",
        entityRoot: "Root directory containing the entity",
        copiesMergedTitle: "Identical independent copies merged",
        copiesMerged: function (n) { return n + " identical copies merged"; },
        chinese: "Chinese",
        demoTranslation: "Demo translation",
        original: "Original",
        translation: "Translation",
        untranslated: "(not translated)",
        copy: "Copy",
        copied: "Copied",
        copyFailed: "Copy failed",
        stats: function (visible, total) { return "Matching " + visible + " / " + total; },
        statsAll: function (total, repos, attributed) {
          return total + " skills · " + repos + " repositories · " + attributed + " attributed";
        },
      }
    : {
        skills: "技能",
        openOnGitHub: "在 GitHub 打开",
        openSkill: function (name) { return "打开 " + name + " 的原文译文对照"; },
        linkedRoot: "链接到该工具根目录",
        entityRoot: "实体所在根目录",
        copiesMergedTitle: "内容一致的独立拷贝已合并",
        copiesMerged: function (n) { return n + " 份拷贝已合并"; },
        chinese: "中文",
        demoTranslation: "演示译文",
        original: "原文",
        translation: "译文",
        untranslated: "（未翻译）",
        copy: "复制",
        copied: "已复制",
        copyFailed: "复制失败",
        stats: function (visible, total) { return "匹配 " + visible + " / " + total; },
        statsAll: function (total, repos, attributed) {
          return total + " 技能 · " + repos + " 仓库 · " + attributed + " 已归属";
        },
      };

  /* ---------- 演示数据(3 组 14 技能;内容取自 seeds/summaries.json、
     data/index.json 与 data/translations/ 真实译文缓存的裁剪节选) ---------- */
  var DEMO = {
  groups: [
  {
    key:"mattpocock/skills", repo:"mattpocock/skills", name:"mattpocock/skills", sourceUrl:"https://github.com/mattpocock/skills",
    repoSummary:"Matt Pocock 的工程技能全集：规格（ grilled spec ）→工单（tracer-bullet）→实现→测试→复盘的完整工作流，外加写作、教学与会话管理配套。38 个技能按 engineering / productivity / misc / in-progress 分组。", count:7,
    subgroups:[{name:null,skills:[
      {"id":"ask-matt","dirName":"ask-matt","name":"ask-matt","description":"Ask which skill or flow fits your situation. A router over the skills in this repo.","summary":"技能路由器：描述你的处境，它推荐本仓库哪个技能或流程最合适。不确定用哪个 Matt 技能时从这里进。","summarySource":"seed","categories":["工程流程"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"mattpocock/skills"}},
      {"id":"code-review","dirName":"code-review","name":"code-review","description":"Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\".","summary":"沿\"标准\"与\"品味\"两轴审查自某个基点（commit/分支/tag/merge-base）以来的全部变更，输出结构化评审意见。","summarySource":"seed","categories":["工程流程","实现与编码"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"mattpocock/skills"}},
      {"id":"tdd","dirName":"tdd","name":"tdd","description":"Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions \"red-green-refactor\", or wants integration tests.","summary":"测试驱动开发：红-绿-重构循环，提到 red-green-refactor 或要求集成测试时启用。","summarySource":"seed","categories":["测试","实现与编码"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"mattpocock/skills"}},
      {"id":"diagnosing-bugs","dirName":"diagnosing-bugs","name":"diagnosing-bugs","description":"Diagnosis loop for hard bugs and performance regressions. Use when the user says \"diagnose\"/\"debug this\", or reports something broken/throwing/failing/slow.","summary":"硬 bug 与性能回归的诊断循环：建立反馈环→最小化复现→列假设→插桩→修复→回归测试。说\"diagnose\"或\"debug this\"即触发。","summarySource":"seed","categories":["调试"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"mattpocock/skills"}},
      {"id":"to-spec","dirName":"to-spec","name":"to-spec","description":"Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed.","summary":"把当前会话综合成一份 spec 并发布到项目 issue tracker——不做访谈，只做已有讨论的合成。","summarySource":"seed","categories":["规格与工单"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"mattpocock/skills"}},
      {"id":"implement","dirName":"implement","name":"implement","description":"Implement a piece of work based on a spec or set of tickets.","summary":"按一份 spec 或一组工单实现一段工作，遵守既有测试与代码规范。","summarySource":"seed","categories":["实现与编码"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"mattpocock/skills"}},
      {"id":"handoff","dirName":"handoff","name":"handoff","description":"Compact the current conversation into a handoff document for another agent to pick up.","summary":"把当前会话压缩成一份交接文档，让下一个代理（或明天的你）无缝接手。","summarySource":"seed","categories":["会话管理"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"mattpocock/skills"}}
    ]}]
  },
  {
    key:"nextlevelbuilder/ui-ux-pro-max-skill", repo:"nextlevelbuilder/ui-ux-pro-max-skill", name:"nextlevelbuilder/ui-ux-pro-max-skill", sourceUrl:"https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    repoSummary:"UI/UX 设计智能引擎七件套：主引擎内置本地可搜索的设计数据库（风格/配色/字体/UX 准则/图标/动效/图表/技术栈），配套设计系统、品牌、横幅、演示文稿技能。纯 Python 标准库数据，无网络调用。", count:4,
    subgroups:[{name:null,skills:[
      {"id":"ui-ux-pro-max","dirName":"ui-ux-pro-max","name":"ui-ux-pro-max","description":"UI/UX design intelligence for web, mobile, and desktop. This skill should be used when designing, building, reviewing, or fixing interfaces, including pages, components, design systems, accessibility, interaction, responsive layout, typography, color, charts, and stack-specific UI implementation. Searchable local data: 79 searchable styles (50 active), 192 product palettes and reasoning profiles, 74 font pairings, 119 UX guidelines, 105 icons, 17 GSAP presets, 25 chart types, and 22 stacks.","summary":"UI/UX 设计智能引擎主技能：本地可搜索 79 种 UI 风格（50 激活）、192 套配色与推理档案、74 组字体搭配、119 条 UX 准则、105 图标、17 个 GSAP 动效预设、25 种图表、22 个技术栈。设计/构建/审查/修复界面，含无障碍、响应式、排版、配色、图表。","summarySource":"seed","categories":["设计智能","前端开发"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"nextlevelbuilder/ui-ux-pro-max-skill"}},
      {"id":"design-system","dirName":"design-system","name":"design-system","description":"Token architecture, component specifications, and slide generation. Three-layer tokens (primitive→semantic→component), CSS variables, spacing/typography scales, component specs, strategic slide creation. Use for design tokens, systematic design, brand-compliant presentations.","summary":"设计令牌架构与组件规范：基础→语义→组件三层令牌、CSS 变量、间距与排版体系，并可生成幻灯片。","summarySource":"seed","categories":["设计系统","前端开发"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"nextlevelbuilder/ui-ux-pro-max-skill"}},
      {"id":"ui-styling","dirName":"ui-styling","name":"ui-styling","description":"Create beautiful, accessible user interfaces with shadcn/ui components (built on Radix UI + Tailwind), Tailwind CSS utility-first styling, and canvas-based visual designs. Use when building user interfaces, implementing design systems, creating responsive layouts, adding accessible components (dialogs, dropdowns, forms, tables), customizing themes and colors, implementing dark mode, generating visual designs and posters, or establishing consistent styling patterns across applications.","summary":"用 shadcn/ui(Radix UI + Tailwind)、Tailwind 工具类与 canvas 构建美观且可访问的用户界面。","summarySource":"seed","categories":["前端开发","设计系统"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"nextlevelbuilder/ui-ux-pro-max-skill"}},
      {"id":"slides","dirName":"slides","name":"slides","description":"Create strategic HTML presentations with Chart.js, design tokens, responsive layouts, copywriting formulas, and contextual slide strategies.","summary":"策略性 HTML 演示文稿：Chart.js 图表、设计令牌、响应式布局、文案公式与分场景幻灯片策略。","summarySource":"seed","categories":["演示文稿"],"roots":[[".agents",false],[".zcode",true],[".claude",true]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":"nextlevelbuilder/ui-ux-pro-max-skill"}}
    ]}]
  },
  {
    key:"__unknown__", repo:null, name:"未知来源", sourceUrl:null,
    repoSummary:"未找到安装记录、git 远端或 frontmatter 来源的技能。可手动归组或配置 LLM 后推断。", count:3,
    subgroups:[{name:null,skills:[
      {"id":"build-to-learn","dirName":"build-to-learn","name":"build-to-learn","description":"Learn by building — learning is the goal, building is the test. When the user wants to make something, first turn the product into scenario scripts, translate those into capability blocks, then cut a ladder of stages: stage 1 is a runnable MVP, every later stage adds one block and still runs.","summary":"「边做边学」技能：以学习为目的、以做出可运行产物为检验，把需求转成场景脚本→能力块→阶段阶梯（阶段1即可运行 MVP，之后每阶段加一块仍可跑），每阶段配组件图作为学习对象，先讲人话逻辑、代码仅作脚注，靠故意撞墙与对比失败来学。适合想让 AI 带着自己从零构建某物并真正理解技术原理的用户（/build-to-learn、「带我做个东西并学会」「别直接帮我写，我要学会」）。铁律为用户亲自动手做实验、一次只推进一步、AI 写代码但由用户下指令和拍决策。","summarySource":"llm","categories":["教学材料","工程流程","学习引导"],"roots":[[".agents",false]],"copyCount":1,"entryLanguage":"zh","attribution":{"repo":null}},
      {"id":"caveman","dirName":"caveman","name":"caveman","description":"Ultra-compressed communication mode. Cuts token usage ~75% by dropping filler, articles, and pleasantries while keeping full technical accuracy. Use when user says \"caveman mode\", \"talk like caveman\", \"use caveman\", \"less tokens\", \"be brief\", or invokes /caveman.","summary":"极简沟通模式技能,通过删去冠词、填充词、客套话和含糊表达,把 token 消耗降低约 75%,同时保留全部技术准确性与代码、报错原文。触发词包括 \"caveman mode\"、\"talk like caveman\"、\"less tokens\"、\"be brief\" 或 /caveman,适用于用户明确要求简短回复的场景;安全警告、不可逆操作确认和多步流程等高风险内容会临时恢复正常表达。","summarySource":"llm","categories":["沟通模式","会话管理"],"roots":[[".agents",false],[".claude",false]],"copyCount":2,"entryLanguage":"en","attribution":{"repo":null}},
      {"id":"frontend-design","dirName":"frontend-design","name":"frontend-design","description":"Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.","summary":"一份前端视觉设计指导技能,在构建新 UI 或重塑现有界面时,帮助确立独特且有意图的美学方向,包括主题锚定、配色、字体排版与版式决策,避免落入模板化默认样式。适用于需要做出辨识度高的视觉设计、避免 AI 生成感页面的场景。","summarySource":"llm","categories":["设计","前端开发","视觉设计"],"roots":[[".agents",false]],"copyCount":1,"entryLanguage":"en","attribution":{"repo":null}}
    ]}]
  }
  ],
  docs: {
  "ask-matt": { path: "SKILL.md", cached: true, blocks: [
      ["b0","heading","# Ask Matt","# 询问 Matt"],
      ["b1","paragraph","You don't remember every skill, so ask.","你不记得所有技能，所以请提问。"],
      ["b3","paragraph","A **flow** is a path through the skills. Most paths run along one **main flow**, and two **on-ramps** merge onto it. Everything else is standalone, or a vocabulary layer that runs underneath.","**流程**是贯穿各项技能的一条路径。大多数路径沿着一条**主流程**运行，另外还有两条**接入路径**汇入其中。其他内容则是独立存在的，或是运行在其下方的词汇层。"],
      ["b4","heading","## The main flow: idea → ship","## 主流程：创意 → 发布"],
      ["b5","paragraph","The route most work travels. You have an idea and want it built.","大多数工作经过的路径。你有一个想法，并希望将其付诸实现。"],
      ["b6","list","1. **`/grill-with-docs`** sharpens the idea by interview. Start here whenever you are **working in a working directory**: it's stateful, retaining what it learns in `GLOSSARY.md` and ADRs. (No working directory? Use `/grill-me` instead, covered under Standalone. Both run the same `/grilling` primitive; `grill-with-docs` is the one that leaves a paper trail, which makes it the better of the two whenever a repo is there to leave it in.)\n2. **Branch: can you settle every question in conversation?** If a question needs a runnable answer (state, business logic, a UI you have to see), detour through a prototype, bridged by **`/handoff`** in both directions (a prototype lives in its own directory, which is exactly what `/handoff` is for; see Phase boundaries):\n   - **`/handoff`** out, then open a fresh session against that file,\n   - **`/prototype`** to answer the question with throwaway code,\n   - **`/handoff`** back what you learned, and reference it from the original idea thread.\n3. **Branch: is this a multi-session build?**\n   - **Yes** → **`/to-spec`** (turn the thread into a spec), then **`/to-tickets`** to split it into tracer-bullet tickets, each declaring its **blocking edges**. Then work the tickets one of two ways:\n     - **`/implement-spec`** for the whole spec in one run. It reads the tickets as a **task graph**, runs implementer subagents across the ready **frontier** in parallel, and lands everything on one **integration branch**. Reach for it when you'd rather orchestrate the build than drive each ticket yourself.\n   - **No** → **`/implement`** right here, in the same context window.","1. **`/grill-with-docs`** 通过访谈来完善想法。只要你**在工作目录中工作**，就从这里开始：它是有状态的，会保留在 `GLOSSARY.md` 和 ADR 中学到的内容。（没有工作目录？改用 `/grill-me`，详见“Standalone”。两者运行的是同一个 `/grilling` 原语；`grill-with-docs` 会留下记录，因此只要有可供记录的代码仓库，它就是两者中更好的选择。）\n2. **分支：你能否在对话中解决每个问题？** 如果某个问题需要可运行的答案（状态、业务逻辑，或必须亲眼查看的 UI），就绕道通过原型解决，并在两个方向上都由 **`/handoff`** 作为桥接（原型位于自己的目录中，而这正是 `/handoff` 的用途；参见“阶段边界”）：\n   - **`/handoff`** 导出，然后针对该文件开启一个全新的会话，\n   - 使用 **`/prototype`** 通过一次性代码回答问题，\n   - 将你了解到的内容通过 **`/handoff`** 带回，并在原始想法线程中引用它。\n3. **分支：这是一个需要多个会话的构建任务吗？**\n   - **是** → 使用 **`/to-spec`**（将线程转化为规范），然后使用 **`/to-tickets`** 将其拆分为示踪弹工单，每个工单都声明自己的**阻塞边**。然后以以下两种方式之一处理这些工单：\n     - 对整个规范使用 **`/implement-spec`**，一次运行完成。它会将工单读取为一个**任务图**，并行运行多个实现者子代理来处理已就绪的**前沿**，最后将所有内容落到一个**集成分支**上。当你更愿意编排整个构建过程，而不是亲自驱动每个工单时，就应使用它。\n   - **否** → 就在这里、在同一个上下文窗口中使用 **`/implement`**。"],
      ["b10","heading","### Context hygiene","### 上下文清理"],
      ["b11","paragraph","Keep steps 1–3 in **one unbroken context window** (don't compact or clear until after `/to-tickets`) so the grilling, spec, and tickets all build on the same thinking. Each `/implement` then starts fresh, working from the ticket. Run `/retro` in the session it's looking back on, before you clear; after clearing, point it at that session's log instead.","将步骤 1–3 保持在**同一个不中断的上下文窗口**中（在 `/to-tickets` 之后再压缩或清除），这样盘问、规范和工单都能基于同一思路逐步构建。每个 `/implement` 随后都从工单出发，开启全新的上下文。在它所回顾的会话中运行 `/retro`，然后再进行清除；清除后，则改为将其指向该会话的日志。"],
      ["b12","paragraph","The limit on this is the **[smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone)**: the window (~150k tokens on state-of-the-art models) within which the model still reasons sharply. If a session approaches it before `/to-tickets`, don't push on degraded; `/compact` at the nearest phase boundary and carry on (see Phase boundaries).","对此的限制在于**[智能区间](https://www.aihero.dev/ai-coding-dictionary/smart-zone)**：在此范围内（在最先进的模型上约为 150k 个 token），模型仍能进行敏锐的推理。如果会话在 `/to-tickets` 之前接近这一范围，请不要在性能下降的情况下继续推进；在最近的阶段边界执行 `/compact`，然后继续（参见“阶段边界”）。"]
    ] },
  "ui-ux-pro-max": { path: "SKILL.md", cached: true, blocks: [
      ["b0","heading","# UI/UX Pro Max - Design Intelligence","# UI/UX Pro Max - 设计智能"],
      ["b1","paragraph","Searchable local UI/UX guidance: 79 searchable styles (50 active), 192 product palettes and exact reasoning profiles, 74 font pairings, 119 UX guidelines, 105 curated icons, 17 GSAP presets, 25 chart types, and 22 technology stacks.","可搜索的本地 UI/UX 指南：79 种可搜索样式（50 种处于活动状态）、192 套产品配色方案及精确的推理配置文件、74 组字体搭配、119 条 UX 指南、105 个精选图标、17 个 GSAP 预设、25 种图表类型，以及 22 套技术栈。"],
      ["b2","heading","## When to Apply","## 适用时机"],
      ["b3","paragraph","Use this Skill when the task involves **UI structure, visual design decisions, interaction patterns, or user experience quality control**: designing new pages, creating/refactoring UI components, choosing color/typography/spacing/layout systems, reviewing UI for UX/accessibility/consistency, implementing navigation/animation/responsive behavior, or improving perceived quality and usability.","当任务涉及 **UI 结构、视觉设计决策、交互模式或用户体验质量控制** 时使用此 Skill：设计新页面、创建/refactoring UI 组件、选择颜色/typography/spacing/layout系统、审查 UI 的 UX/accessibility/consistency、实现导航/animation/responsive行为，或改善感知质量和易用性。"],
      ["b5","heading","## Rule Categories by Priority","## 按优先级划分的规则类别"],
      ["b7","table","| Priority | Category | Impact | Domain | Key Checks (Must Have) | Anti-Patterns (Avoid) |\n|----------|----------|--------|--------|------------------------|------------------------|\n| 1 | Accessibility | CRITICAL | `ux` | Contrast 4.5:1, Alt text, Keyboard nav, Aria-labels | Removing focus rings, Icon-only buttons without labels |\n| 2 | Touch & Interaction | CRITICAL | `ux` | Min size 44×44px, 8px+ spacing, Loading feedback | Reliance on hover only, Instant state changes (0ms) |\n| 3 | Performance | HIGH | `ux` | WebP/AVIF, Lazy loading, Reserve space (CLS &lt; 0.1) | Layout thrashing, Cumulative Layout Shift |\n| 4 | Style Selection | HIGH | `style`, `product` | Match product type, Consistency, SVG icons (no emoji) | Mixing flat & skeuomorphic randomly, Emoji as icons |\n| 5 | Layout & Responsive | HIGH | `ux` | Mobile-first breakpoints, Viewport meta, No horizontal scroll | Horizontal scroll, Fixed px container widths, Disable zoom |\n| 6 | Typography & Color | MEDIUM | `typography`, `color` | Base 16px, Line-height 1.5, Semantic color tokens | Text &lt; 12px body, Gray-on-gray, Raw hex in components |\n| 7 | Animation | MEDIUM | `ux`, `gsap` | Context-aware timing, Motion conveys meaning, Spatial continuity | One duration for every transition, Animating width/height, No reduced-motion |\n| 8 | Forms & Feedback | MEDIUM | `ux` | Visible labels, Error near field, Helper text, Progressive disclosure | Placeholder-only label, Errors only at top, Overwhelm upfront |\n| 9 | Navigation Patterns | HIGH | `ux` | Predictable back, Bottom nav ≤5, Deep linking | Overloaded nav, Broken back behavior, No deep links |\n| 10 | Charts & Data | LOW | `chart` | Legends, Tooltips, Accessible colors | Relying on color alone to convey meaning |","| 优先级 | 类别 | 影响 | 领域 | 关键检查项（必须具备） | 反模式（避免） |\n|----------|----------|--------|--------|------------------------|------------------------|\n| 1 | 无障碍 | 严重 | `ux` | 对比度 4.5:1、替代文本、键盘导航、Aria-label | 移除焦点环、没有标签的纯图标按钮 |\n| 2 | 触控与交互 | 严重 | `ux` | 最小尺寸 44×44px、间距至少 8px、加载反馈 | 仅依赖悬停、即时状态变化（0ms） |\n| 3 | 性能 | 高 | `ux` | WebP/AVIF、懒加载、预留空间（CLS &lt; 0.1） | 布局抖动、累积布局偏移 |\n| 4 | 样式选择 | 高 | `style`、`product` | 匹配产品类型、一致性、SVG 图标（不使用表情符号） | 随意混用扁平化与拟物化风格、使用表情符号作为图标 |\n| 5 | 布局与响应式 | 高 | `ux` | 移动端优先断点、Viewport meta、不出现水平滚动 | 水平滚动、固定 px 容器宽度、禁用缩放 |\n| 6 | 排版与颜色 | 中 | `typography`、`color` | 基准 16px、行高 1.5、语义化颜色 token | 正文小于 12px、灰色叠加灰色、在组件中直接使用原始十六进制值 |\n| 7 | 动画 | 中 | `ux`、`gsap` | 根据上下文设置时长、动效传达含义、空间连续性 | 所有过渡使用同一时长、对宽度/height进行动画、不支持减少动效 |\n| 8 | 表单与反馈 | 中 | `ux` | 可见标签、错误信息靠近字段、辅助文本、渐进式披露 | 仅使用占位符作为标签、错误信息仅显示在顶部、一次性展示过多内容 |\n| 9 | 导航模式 | 高 | `ux` | 可预测的返回行为、底部导航 ≤5、深层链接 | 导航过载、返回行为失效、没有深层链接 |\n| 10 | 图表与数据 | 低 | `chart` | 图例、工具提示、无障碍颜色 | 仅依靠颜色传达含义 |"],
      ["b9","hr","---",null],
      ["b10","heading","## Running the search tool","## 运行搜索工具"],
      ["b11","paragraph","The search script lives inside this skill's own directory, not the project directory. Always invoke it by its full path — do not assume a particular working directory:","搜索脚本位于此 Skill 自身的目录中，而非项目目录中。始终使用其完整路径调用——不要假设特定的工作目录："],
      ["b12","code","```bash\npython \"${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py\" \"<query>\" --domain <domain>\n```",null]
    ] },
  "caveman": { path: "SKILL.md", cached: true, blocks: [
      ["b0","paragraph","Respond terse like smart caveman. All technical substance stay. Only fluff die.","像聪明的穴居人一样简短回应。保留所有技术实质。只让废话消失。"],
      ["b1","heading","## Persistence","## 持续性"],
      ["b2","paragraph","ACTIVE EVERY RESPONSE once triggered. No revert after many turns. No filler drift. Still active if unsure. Off only when user says \"stop caveman\" or \"normal mode\".","触发后每次回应都生效。多轮对话后也不恢复。不要逐渐加入填充内容。不确定时仍保持生效。仅当用户说“stop caveman”或“normal mode”时关闭。"],
      ["b3","heading","## Rules","## 规则"],
      ["b4","paragraph","Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not \"implement a solution for\"). Abbreviate common terms (DB/auth/config/req/res/fn/impl). Strip conjunctions. Use arrows for causality (X -> Y). One word when one word enough.","删除：冠词（a/an/the）、填充词（just/really/basically/actually/simply）、客套话（sure/certainly/of course/happy to）、模棱两可的措辞。可以使用片段。使用简短同义词（用 big，不用 extensive；用 fix，不用“implement a solution for”）。缩写常见术语（DB/auth/config/req/res/fn/impl）。去掉连接词。用箭头表示因果关系（X -> Y）。一个词足够时就用一个词。"],
      ["b5","paragraph","Technical terms stay exact. Code blocks unchanged. Errors quoted exact.","技术术语保持准确。代码块保持不变。错误信息原样引用。"],
      ["b6","paragraph","Pattern: `[thing] [action] [reason]. [next step].`","格式：`[thing] [action] [reason]. [next step].`"],
      ["b7","paragraph","Not: \"Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by...\"\nYes: \"Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:\"","不要：“Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by...”\n要：“认证中间件存在 Bug。令牌过期检查使用 `<`，而不是 `<=`。修复：”"],
      ["b8","heading","### Examples","### 示例"],
      ["b9","paragraph","**\"Why React component re-render?\"**","**“Why React component re-render?”**"],
      ["b10","quote","> Inline obj prop -> new ref -> re-render. `useMemo`.","> 内联对象属性 -> 新引用 -> 重新渲染。`useMemo`。"],
      ["b11","paragraph","**\"Explain database connection pooling.\"**","**“Explain database connection pooling.”**"],
      ["b12","quote","> Pool = reuse DB conn. Skip handshake -> fast under load.","> 连接池 = 复用 DB 连接。跳过握手 -> 高负载下更快。"],
      ["b13","heading","## Auto-Clarity Exception","## 自动清晰度例外"],
      ["b14","paragraph","Drop caveman temporarily for: security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread, user asks to clarify or repeats question. Resume caveman after clear part done.","以下情况暂时不使用穴居人式表达：安全警告、不可逆操作确认、片段顺序可能导致误读的多步骤序列、用户要求澄清或重复提问。清晰部分完成后恢复穴居人式表达。"],
      ["b15","paragraph","Example -- destructive op:","示例 -- 破坏性操作："],
      ["b16","quote","> **Warning:** This will permanently delete all rows in the `users` table and cannot be undone.\n>\n> ```sql\n> DROP TABLE users;\n> ```\n>\n> Caveman resume. Verify backup exist first.","> **警告：**这将永久删除 `users` 表中的所有行，且无法撤销。\n>\n> ```sql\n> DROP TABLE users;\n> ```\n>\n> 恢复穴居人式表达。先确认备份存在。"]
    ] },
  "frontend-design": { path: "SKILL.md", cached: true, blocks: [
      ["b0","heading","# Frontend Design","# 前端设计"],
      ["b1","paragraph","Approach this as the design lead at a design studio known for giving every client a distinct visual identity that is not mistaken for anyone else's. This client has already rejected proposals that felt cliché or templated, and is paying for a distinctive point of view: make deliberate, opinionated choices about palette, typography, and layout that are specific to this brief, and take aesthetic risk if justified.","请以一家设计工作室的设计负责人的身份来处理这项工作。该工作室以为每位客户打造独特的视觉识别而闻名，确保不会被误认为属于其他任何人。这位客户已经拒绝了那些感觉陈词滥调或像模板的方案，他们付费是为了获得独特的视角：针对这份简报，对色彩、字体和布局做出经过深思熟虑且有明确立场的选择；如果审美上的冒险有充分理由，就应当承担这种风险。"],
      ["b2","heading","## Ground your designs in the subject matter","## 让设计扎根于主题内容"],
      ["b3","paragraph","If the brief does not identify what the product or subject matter is, identify it yourself before designing, and confirm with the client. You can come up with one concrete subject, the design's audience, and the design's primary job, as a proposal. If there's any information in your memory about the client's preferences or context about what they're building, use that as a hint. The subject's industry, subject matter, materials, and vernacular are where distinctive visual choices come from — a design for a toy for girls aged 8–11 will be very aesthetically different from a dashboard for financial analysts. Build with the brief's real content and subject matter throughout.","如果简报没有明确说明产品或主题内容是什么，请在设计前自行确定，并与客户确认。你可以提出一个具体的主题、设计受众以及设计的主要任务，作为方案。如果你的记忆中有任何关于客户偏好或其正在构建内容的背景信息，请将其作为线索。主题所属的行业、主题内容、材料和惯用表达，正是独特视觉选择的来源——为 8–11 岁女孩设计的玩具，与面向金融分析师的仪表板，在审美上会有很大不同。整个构建过程都应围绕简报的真实内容和主题展开。"],
      ["b4","heading","## Design principles","## 设计原则"],
      ["b5","paragraph","For web designs, the hero is the first thing viewers will see. Open with the most characteristic thing in the subject's world, in the form that is most appropriate: a headline, an image, an animation, a live demo, an interactive moment, or other treatments. Be deliberate with your choice: a big number with a small label, supporting stats, and a gradient accent is the default treatment, so only use it if that's truly the best option.","对于网页设计，首屏主视觉是访客首先看到的内容。应以主题世界中最具特征的事物开场，并采用最合适的形式：标题、图像、动画、实时演示、交互时刻或其他处理方式。应有意识地进行选择：大数字配小标签、辅助统计数据和渐变强调色是默认处理方式，因此只有在这确实是最佳选项时才使用它。"],
      ["b6","paragraph","Typography carries the personality of the page. You don't need a different typeface for display or headline text and body content: use one family or two, and if two, make them clearly distinct.","字体承载着页面的个性。展示文本或标题文本与正文内容不必使用不同的字体：使用一个字体家族即可，也可以使用两个；如果使用两个，应让它们有明显区别。"]
    ] },
  "code-review": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# code-review","# code-review"],
      ["s1","paragraph","Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side.","沿\"标准\"与\"品味\"两轴审查自某个基点（commit/分支/tag/merge-base）以来的全部变更，输出结构化评审意见。"],
      ["s2","paragraph","When to use: Use when the user asks to review a branch, a PR, or work-in-progress changes, or says \"review since X\".","何时使用:用户要求审查分支、PR 或进行中的改动,或说 \"review since X\" 时启用。"],
      ["s3","list","- Two axes: Standards (this repo's documented coding standards) and Spec (what the originating issue asked for).\n- Both reviews run in parallel sub-agents and are reported side by side.","- 沿两轴审查:「标准」(仓库文档化的编码规范)与「规格」(原始 issue 的要求)。\n- 两项审查由并行子代理执行,结论并排输出。"]
    ] },
  "tdd": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# tdd","# tdd"],
      ["s1","paragraph","Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions \"red-green-refactor\", or wants integration tests.","测试驱动开发：红-绿-重构循环，提到 red-green-refactor 或要求集成测试时启用。"],
      ["s2","paragraph","When to use: Use when the user wants to build features or fix bugs test-first, mentions \"red-green-refactor\", or wants integration tests.","何时使用:想以测试先行的方式做功能或修 bug、提到 red-green-refactor,或要求集成测试时启用。"],
      ["s3","list","- Loop: red → green → refactor.\n- Companion docs: mocking.md, tests.md.","- 循环:红 → 绿 → 重构。\n- 配套文档:mocking.md、tests.md。"]
    ] },
  "diagnosing-bugs": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# diagnosing-bugs","# diagnosing-bugs"],
      ["s1","paragraph","Diagnosis loop for hard bugs and performance regressions. Use when the user says \"diagnose\"/\"debug this\", or reports something broken/throwing/failing/slow.","硬 bug 与性能回归的诊断循环：建立反馈环→最小化复现→列假设→插桩→修复→回归测试。"],
      ["s2","paragraph","When to use: Use when the user says \"diagnose\" or \"debug this\", or reports something broken, throwing, failing, or slow.","何时使用:说 \"diagnose\" 或 \"debug this\",或报告有东西损坏、抛错、失败、变慢时启用。"],
      ["s3","list","- Loop: feedback loop → minimal repro → hypotheses → instrumentation → fix → regression test.","- 循环:反馈环 → 最小化复现 → 列假设 → 插桩 → 修复 → 回归测试。"]
    ] },
  "to-spec": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# to-spec","# to-spec"],
      ["s1","paragraph","Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed.","把当前会话综合成一份 spec 并发布到项目 issue tracker——不做访谈，只做已有讨论的合成。"],
      ["s2","paragraph","When to use: Use when a discussion has already produced a plan and it should be captured as a spec in the issue tracker.","何时使用:讨论已产出方案、需要落成 spec 发布到 issue tracker 时启用。"],
      ["s3","list","- No interview: synthesizes what was already discussed.\n- Publishes to the configured project issue tracker.","- 不做访谈,只综合已有讨论。\n- 发布到配置好的项目 issue tracker。"]
    ] },
  "implement": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# implement","# implement"],
      ["s1","paragraph","Implement a piece of work based on a spec or set of tickets.","按一份 spec 或一组工单实现一段工作，遵守既有测试与代码规范。"],
      ["s2","paragraph","When to use: Use when a spec or a set of tickets is ready to be turned into code.","何时使用:spec 或一组工单已就绪、要落成代码时启用。"],
      ["s3","list","- Respects existing tests and the repo's coding standards.","- 遵守既有测试与仓库的代码规范。"]
    ] },
  "handoff": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# handoff","# handoff"],
      ["s1","paragraph","Compact the current conversation into a handoff document for another agent to pick up.","把当前会话压缩成一份交接文档，让下一个代理（或明天的你）无缝接手。"],
      ["s2","paragraph","When to use: Use when a conversation holds context that another agent (or tomorrow's you) will need.","何时使用:会话里的上下文需要交给下一个代理(或明天的你)时启用。"],
      ["s3","list","- Compacts the conversation into a handoff document for seamless pickup.","- 把当前会话压缩成交接文档,接手方无缝继续。"]
    ] },
  "design-system": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# design-system","# design-system"],
      ["s1","paragraph","Token architecture, component specifications, and slide generation. Three-layer tokens (primitive→semantic→component), CSS variables, spacing/typography scales, component specs, strategic slide creation.","设计令牌架构与组件规范：基础→语义→组件三层令牌、CSS 变量、间距与排版体系，并可生成幻灯片。"],
      ["s2","paragraph","When to use: Use for design tokens, systematic design, and brand-compliant presentations.","何时使用:涉及设计令牌、系统化设计或品牌合规的演示文稿时启用。"],
      ["s3","list","- Three token layers: primitive → semantic → component.\n- References cover component specs, states/variants and Tailwind integration.","- 三层令牌:基础 → 语义 → 组件。\n- 参考文档覆盖组件规范、状态变体与 Tailwind 集成。"]
    ] },
  "ui-styling": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# ui-styling","# ui-styling"],
      ["s1","paragraph","Create beautiful, accessible user interfaces with shadcn/ui components (built on Radix UI + Tailwind), Tailwind CSS utility-first styling, and canvas-based visual designs. Use when building user interfaces, implementing design systems, creating responsive layouts, adding accessible components (dialogs, dropdowns, forms, tables), customizing themes and colors, implementing dark mode, generating visual designs and posters, or establishing consistent styling patterns across applications.","用 shadcn/ui(Radix UI + Tailwind)、Tailwind 工具类与 canvas 构建美观且可访问的用户界面。"],
      ["s2","paragraph","When to use: Use when building UI, implementing a design system, adding accessible components, theming, or enabling dark mode.","何时使用:构建界面、落地设计系统、添加可访问组件、定制主题或开启暗色模式时启用。"],
      ["s3","list","- Stack: shadcn/ui on Radix UI + Tailwind CSS.\n- References cover accessibility, components, theming and responsive utilities.","- 技术栈:shadcn/ui(Radix UI)+ Tailwind CSS。\n- 参考文档覆盖无障碍、组件、主题与响应式工具类。"]
    ] },
  "slides": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# slides","# slides"],
      ["s1","paragraph","Create strategic HTML presentations with Chart.js, design tokens, responsive layouts, copywriting formulas, and contextual slide strategies.","策略性 HTML 演示文稿：Chart.js 图表、设计令牌、响应式布局、文案公式与分场景幻灯片策略。"],
      ["s2","paragraph","When to use: Use when the deliverable is a strategic HTML presentation.","何时使用:交付物是策略性 HTML 演示文稿时启用。"],
      ["s3","list","- Chart.js charts, design tokens, responsive layouts, copywriting formulas.","- 内置 Chart.js 图表、设计令牌、响应式布局与文案公式。"]
    ] },
  "build-to-learn": { path: "SKILL.md", cached: true, blocks: [
      ["s0","heading","# build-to-learn","# build-to-learn"],
      ["s1","paragraph","Learn by building — learning is the goal, building is the test. The product becomes scenario scripts, then capability blocks, then a ladder of stages: stage 1 is a runnable MVP, and every later stage adds one block and still runs.","「边做边学」:以学习为目的、以做出可运行产物为检验。"],
      ["s2","paragraph","When to use: Use when the user wants to deeply learn how something works by building it — not get code dumped on them.","何时使用:想让 AI 带着自己从零构建某物并真正理解原理,而不是直接要一份代码时启用。"],
      ["s3","list","- Plain-language logic first, code as the footnote.\n- Experiments favor deliberate wall-hitting and contrastive failure.","- 先讲人话逻辑,代码仅作脚注。\n- 实验刻意「撞墙」并做对比失败,从差异里学。"]
    ] }
  }
};

  /* ---------- 状态(对应 public/app.js 的 S,仅保留演示所需字段) ---------- */
  const S = {
    data: null,          // { groups, categories, stats }
    q: "", cat: null,    // 搜索词 / 选中的分类(单选,再点一次取消)
    collapsed: new Set(),// 折叠的仓库分组 key
    viewer: null,        // 打开阅读器时为 { skill, doc }
    opener: null,        // 打开阅读器的那张卡片(关闭后焦点回到它)
  };

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
    ));
  }

  /* 根目录徽章配色:与 public/app.js 的 rootBadgeClass 同源;
     名单外目录散列到 10 色冗余池,同一目录颜色稳定。 */
  const KNOWN_ROOT_SLUGS = new Set([
    "agents",
    "claude", "copilot", "gemini", "windsurf", "opencode", "crush", "aider",
    "zed", "kiro", "roo", "continue", "droid", "factory", "amp",
    "codex", "cursor", "goose", "kimi", "cline",
    "zcode", "zai", "zhipu", "codegeex", "deepseek", "qwen", "qoder",
    "codebuddy", "comate", "trae", "marscode",
  ]);
  const ROOT_AUTO_COLORS = 10;

  function rootBadgeClass(label) {
    const slug = String(label || "").replace(/^\./, "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!slug) return "";
    if (KNOWN_ROOT_SLUGS.has(slug)) return ` demo-root-${slug}`;
    let h = 0;
    for (const ch of slug) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return ` demo-root-auto${h % ROOT_AUTO_COLORS}`;
  }

  /* ---------- 初始化数据:分类计数与统计行 ---------- */
  function initData() {
    const counts = {};
    let attributed = 0;
    const repos = new Set();
    for (const g of DEMO.groups) {
      for (const sg of g.subgroups) {
        for (const c of sg.skills) {
          for (const cat of c.categories || []) counts[cat] = (counts[cat] || 0) + 1;
        }
      }
      if (g.repo) { repos.add(g.repo); attributed += g.count; }
    }
    const categories = Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    const entities = DEMO.groups.reduce((a, g) => a + g.count, 0);
    S.data = { groups: DEMO.groups, categories, stats: { entities, repos: repos.size, attributed } };
  }

  /* ============ 分类筛选(裁剪自 renderCategories) ============ */
  function renderCategories() {
    const box = $("demo-chips");
    box.innerHTML = "";
    for (const c of S.data.categories) {
      const chip = document.createElement("span");
      chip.className = "demo-chip" + (S.cat === c.name ? " on" : "");
      chip.innerHTML = `${esc(c.name)}<small>${c.count}</small>`;
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chip.click(); } };
      chip.onclick = () => {
        S.cat = S.cat === c.name ? null : c.name; // 单选:再点一次取消
        renderCategories();
        renderGroups();
      };
      box.appendChild(chip);
    }
  }

  /* ============ 过滤(纯前端,与 matches() 同逻辑) ============ */
  function matches(card, group) {
    if (S.cat && !(card.categories || []).includes(S.cat)) return false;
    if (!S.q) return true;
    const q = S.q.toLowerCase();
    const hay = [
      card.name, card.dirName, card.description, card.summary,
      card.categories.join(" "), group ? group.repo : "",
    ].join(" ").toLowerCase();
    return hay.includes(q);
  }

  /* ============ 列表渲染(裁剪自 renderGroups:无低置信度/多选/子分组) ============ */
  function renderGroups() {
    const box = $("demo-groups");
    box.innerHTML = "";
    let visibleTotal = 0;

    for (const group of S.data.groups) {
      const skills = [];
      for (const sg of group.subgroups) {
        for (const c of sg.skills) {
          if (matches(c, group)) skills.push(c);
        }
      }
      visibleTotal += skills.length;
      if (!skills.length) continue;

      const sec = document.createElement("section");
      sec.className = "demo-group" + (S.collapsed.has(group.key) ? " closed" : "");

      const head = document.createElement("div");
      head.className = "demo-group-head";
      head.onclick = (e) => {
        // 仓库描述是纯表述文字:点击不折叠;用户正在划选文本时也不折叠
        if (e.target.closest(".demo-group-desc")) return;
        const sel = window.getSelection();
        if (sel && sel.type === "Range") return;
        if (S.collapsed.has(group.key)) S.collapsed.delete(group.key); else S.collapsed.add(group.key);
        renderGroups();
      };
      const ghLink = group.sourceUrl
        ? `<a class="demo-gh" href="${esc(group.sourceUrl)}" target="_blank" rel="noreferrer" title="${T.openOnGitHub} ${esc(group.name)}" onclick="event.stopPropagation()">GitHub ↗</a>`
        : "";
      head.innerHTML = `
        <span class="demo-caret" aria-hidden="true">▼</span>
        <span class="demo-group-title">${esc(group.name)}</span>
        ${ghLink}
        <span class="demo-group-count">${skills.length} ${T.skills}</span>
        <p class="demo-group-desc">${esc(group.repoSummary)}</p>`;
      sec.appendChild(head);

      const body = document.createElement("div");
      body.className = "demo-group-body";
      body.appendChild(cardsGrid(skills));
      sec.appendChild(body);
      box.appendChild(sec);
    }

    $("demo-empty").hidden = visibleTotal > 0;
    const filtering = Boolean(S.q || S.cat);
    $("demo-stats").textContent = filtering
      ? T.stats(visibleTotal, S.data.stats.entities)
      : T.statsAll(S.data.stats.entities, S.data.stats.repos, S.data.stats.attributed);
  }

  function cardsGrid(cards) {
    const grid = document.createElement("div");
    grid.className = "demo-cards";
    for (const card of cards) grid.appendChild(cardEl(card));
    return grid;
  }

  /* ============ 卡片(裁剪自 cardEl:无选择/推断/变体徽章) ============ */
  function cardEl(card) {
    const el = document.createElement("article");
    el.className = "demo-card";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", T.openSkill(card.name));

    const badges = [];
    for (const r of card.roots || []) {
      badges.push(`<span class="demo-badge demo-root${r[1] ? " linked" : ""}${rootBadgeClass(r[0])}" title="${r[1] ? T.linkedRoot : T.entityRoot}">${esc(r[0])}</span>`);
    }
    if (card.copyCount > 1) badges.push(`<span class="demo-badge demo-copy" title="${T.copiesMergedTitle}">${T.copiesMerged(card.copyCount)}</span>`);
    if (card.entryLanguage === "zh") badges.push(`<span class="demo-badge demo-zh">${T.chinese}</span>`);

    const cats = (card.categories || [])
      .map((c) => `<span class="demo-cat-tag" data-cat="${esc(c)}">${esc(c)}</span>`).join("");

    el.innerHTML = `
      <div class="demo-card-title"><span class="demo-card-name">${esc(card.name)}</span></div>
      <div class="demo-badges">${badges.join("")}</div>
      <div class="demo-card-summary ${card.summarySource || ""}">${esc(card.summary || "")}</div>
      ${card.categories?.length ? `<div class="demo-card-cats">${cats}</div>` : ""}
      <div class="demo-card-desc">${esc(card.description || "")}</div>`;

    el.onclick = (e) => {
      const cat = e.target.closest(".demo-cat-tag");
      if (cat) {
        S.cat = cat.dataset.cat; // 单选:点卡片标签即选中该分类
        renderCategories();
        renderGroups();
        return;
      }
      openViewer(card.id, el);
    };
    el.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); openViewer(card.id, el); }
    };
    return el;
  }

  /* ============ 对照阅读器(裁剪自 openViewer/closeViewer,容器为演示窗口) ============ */
  function openViewer(id, openerEl) {
    const skill = S.data.groups
      .flatMap((g) => g.subgroups.flatMap((sg) => sg.skills))
      .find((c) => c.id === id);
    const doc = DEMO.docs[id];
    if (!skill || !doc) return;
    S.viewer = { skill, doc };
    S.opener = openerEl || null;
    $("demo-skill").textContent = skill.name;
    $("demo-path").textContent = doc.path;
    $("demo-meta").innerHTML = `<span class="demo-badge demo-violet">${T.demoTranslation}</span>`;
    renderBilingual(doc);
    $("demo-reader").hidden = false;
    $("demo-view").scrollTop = 0;
  }

  function closeViewer() {
    $("demo-reader").hidden = true;
    S.viewer = null;
    // 焦点回到打开阅读器的那张卡片(卡片可能因重渲染已不在文档中)
    if (S.opener && S.opener.isConnected) S.opener.focus();
    S.opener = null;
  }

  /* ============ 原文/译文两列(裁剪自 renderBilingual:演示数据全部命中缓存) ============ */
  function renderBilingual(doc) {
    const view = $("demo-view");
    // 列头固定在滚动区外,.demo-bilingual 才是滚动元素
    view.innerHTML = `<div class="demo-bilingual-head"><span>${T.original}</span><span>${T.translation}</span></div><div class="demo-bilingual"></div>`;
    const wrap = view.querySelector(".demo-bilingual");

    for (const b of doc.blocks) {
      const row = document.createElement("div");
      if (b[1] === "code" || b[1] === "hr") {
        // 代码块与分隔线整行展示,不参与翻译
        row.className = "demo-brow demo-full";
        row.innerHTML = `<div class="demo-md">${renderBlockMarkdown(b)}</div>`;
      } else {
        row.className = "demo-brow";
        const dst = b[3]
          ? `<div class="demo-b-dst demo-md">${renderBlockMarkdown([b[0], b[1], b[3]])}</div>`
          : `<div class="demo-b-dst demo-empty-note">${T.untranslated}</div>`;
        row.innerHTML = `<div class="demo-b-src demo-md">${renderBlockMarkdown(b)}</div>${dst}`;
      }
      wrap.appendChild(row);
    }
    attachCodeCopy(wrap);
  }

  /* 代码块悬停复制按钮:优先 navigator.clipboard,file:// 下回退 execCommand */
  function attachCodeCopy(root) {
    root.querySelectorAll(".demo-md pre").forEach((pre) => {
      if (pre.querySelector(".demo-code-copy")) return;
      const btn = document.createElement("button");
      btn.className = "demo-code-copy";
      btn.type = "button";
      btn.textContent = T.copy;
      btn.onclick = async () => {
        const text = pre.querySelector("code")?.textContent ?? pre.textContent;
        let ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          ok = copyFallback(text);
        }
        btn.textContent = ok ? T.copied : T.copyFailed;
        btn.disabled = true;
        setTimeout(() => { btn.textContent = T.copy; btn.disabled = false; }, 1500);
      };
      pre.appendChild(btn);
    });
  }

  function copyFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  /* ============ Markdown 渲染(浏览器端零依赖,自 renderBlockMarkdown 移植;
       演示数据无图片,去掉 fileUrl 解析) ============ */
  function renderBlockMarkdown(block) {
    const src = block[2] ?? "";
    switch (block[1]) {
      case "heading": return renderHeading(src);
      case "code": return renderCode(src);
      case "hr": return "<hr>";
      case "list": return renderList(src);
      case "quote": return renderQuote(src);
      case "table": return renderTable(src);
      default: return `<p>${renderInline(src)}</p>`;
    }
  }

  function renderHeading(src) {
    const m = /^(#{1,6})\s+(.*)$/.exec(src.trim());
    if (!m) return `<p>${renderInline(src)}</p>`;
    const level = m[1].length;
    return `<h${level}>${renderInline(m[2])}</h${level}>`;
  }

  function renderCode(src) {
    const m = /^```\w*\n([\s\S]*?)\n?```$/.exec(src.trim()) || /^(`{3,})\w*\n([\s\S]*)\1$/.exec(src.trim());
    const code = m ? (m[2] ?? m[1]) : src;
    return `<pre><code>${esc(code)}</code></pre>`;
  }

  function renderList(src) {
    const lines = src.split("\n");
    const items = [];
    let ordered = false;
    for (const line of lines) {
      const m = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
      if (!m) continue;
      if (/\d/.test(m[1])) ordered = true;
      items.push(m[2]);
    }
    const tag = ordered ? "ol" : "ul";
    return `<${tag}>${items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</${tag}>`;
  }

  function renderQuote(src) {
    const inner = src.split("\n").map((l) => l.replace(/^\s*>\s?/, "")).join("\n");
    const paras = inner.split(/\n\n+/).map((p) => `<p>${renderInline(p.replace(/\n/g, " "))}</p>`).join("");
    return `<blockquote>${paras}</blockquote>`;
  }

  function renderTable(src) {
    const rows = src.split("\n").filter((l) => l.trim());
    if (rows.length < 2) return `<p>${renderInline(src)}</p>`;
    const cells = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    const head = cells(rows[0]);
    const bodyRows = rows.slice(2).map(cells);
    return `<table><thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>` +
      `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function renderInline(text) {
    let out = esc(text);
    // 行内代码先摘出,避免内部被再次处理
    const codes = [];
    out = out.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return `\x00${codes.length - 1}\x00`;
    });
    // 链接
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label, url) => {
      return `<a href="${esc(url)}" target="_blank" rel="noreferrer">${label}</a>`;
    });
    // 加粗/斜体
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    // 还原行内代码
    out = out.replace(/\x00(\d+)\x00/g, (_, i) => `<code>${codes[+i]}</code>`);
    return out;
  }

  /* ============ 启动 ============ */
  function boot() {
    if (!$("demo-chips")) return;
    initData();
    renderCategories();
    renderGroups();

    $("demo-q").addEventListener("input", (e) => {
      S.q = e.target.value;
      renderGroups();
    });
    $("demo-back").addEventListener("click", closeViewer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && S.viewer) closeViewer();
    });
  }

  boot();
})();
