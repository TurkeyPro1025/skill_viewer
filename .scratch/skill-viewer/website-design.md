# 官网设计稿 · Skill 译站

> 单页官网。骨架参考 [skillsmanager.dev](https://skillsmanager.dev)(粘性导航 → Hero+信任徽章 → 痛点 → 特性 → 兼容矩阵 → 安全 → FAQ → 下载 → 页脚),视觉延续应用本体的浅色玻璃拟态(与 `public/style.css` 同源令牌),做到「官网即产品同一品牌」。
>
> 状态:设计稿(未实施)。README 四处配套改点已于 2026-10-19 完成,见文末。

---

## 1. 目标与原则

- **目标**:一页讲清「Skill 译站是什么、解决什么、怎么拿、安全吗」,主 CTA 指向 GitHub Releases。
- **硬约束**(沿袭 CONTRIBUTING 约定):零构建、零 CDN、零 npm 依赖、中文优先;纯静态 HTML/CSS/原生 JS。
- **文案口径**与 README 完全一致,不夸大:只读不改、翻译按次计积分、安装包未签名、桌面版仅 Windows。
- **设计本质**:沿用 v1 已认可的结构;「分类选型」概念消化为**特性段的一张卡**(第二条),不另立场景段。

## 2. 设计语言(与应用同源)

| 令牌 | 值(取自 `public/style.css` 浅色主题) |
| --- | --- |
| 背景 | `--bg: #e9eef6` → `--bg-deep: #dfe6f2` 线性渐变 |
| 环境光 | `body::before` 固定视口三层 radial:蓝 `rgba(59,130,246,.14)` 左上 / 靛紫 `rgba(99,102,241,.10)` 右上 / 绿 `rgba(34,197,94,.06)` 底部 |
| 玻璃卡 | `background: rgba(255,255,255,.66)`,hover `.85`;`border: 1px solid rgba(148,163,184,.25)`;`backdrop-filter: blur(12–20px) saturate(140%)` |
| 主色 | `--accent: #2563eb`(`--accent-ink: #1d4ed8`,辉光 `rgba(37,99,235,.30)`);辅紫 `#7c3aed`、绿 `#059669`、琥珀(警示)`#d97706` |
| 文字 | `--ink: #17233a` / `--ink-2: #52607a` / `--ink-3: #8a94a8` |
| 形状 | 圆角 卡片 14 / 弹层 16 / 胶囊按钮 999;双阴影 `0 1px 2px + 0 8px 28px rgba(23,35,58,.08)`,弹层 `0 18px 48px rgba(23,35,58,.14)` |
| 字体 | `"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",system-ui`;代码 `Consolas,"Cascadia Mono",monospace` |
| 降级 | `@supports not (backdrop-filter)` 回退不透明;`prefers-reduced-motion` 关动效 |

**栅格**:内容区 1080px,Hero 模拟图 920px,FAQ 760px;断点 900px(3 列→2 列、模拟图收侧栏)、640px(单列)。

## 3. 页面结构总览

| # | 区块 | 锚点 | 要点 |
| --- | --- | --- | --- |
| 0 | 粘性玻璃导航 | — | logo+品牌 / 五锚点 / GitHub / 下载按钮 |
| 1 | Hero | `#top` | 标题+副标题 / 双 CTA / 三信任徽章 / CSS 界面模拟图 |
| 2 | 它解决什么问题 | `#why` | 三痛点卡(读不懂/来源不明/重复混乱) |
| 3 | 核心特性 | `#features` | 六卡,**含新增「分类速查」** |
| 4 | 兼容 | `#compat` | 23 工具根胶囊网格 + lock 清单说明条 |
| 5 | 安全与隐私 | `#security` | 四卡 |
| 6 | 常见问题 | `#faq` | 六条手风琴 |
| 7 | 下载 | `#download` | 桌面版/网页版两卡 + 未签名提示 |
| 8 | 页脚 | — | 品牌 + 三列链接 + 版权条 |

## 4. 各区块详设(文案终稿)

### 0. 导航

`logo.png(28) + 「Skill 译站」+ 副标「中英对照学习」(≥1080px 才显示)` | 锚点:为什么 · 特性 · 兼容 · 安全 · 常见问题 | GitHub 图标外链 | 「下载」主按钮(锚到 `#download`)。
滚动时当前区块对应链接高亮(主色+底衬);吸顶 `backdrop-blur` 玻璃条,底部 1px 线。

### 1. Hero

- **徽章胶囊**:「MIT 开源 · v0.1.0 · 本地优先」
- **主标题**:装进来的几十个 Skill,**逐段读懂**(后半句主色→紫渐变字)
- **副标题**:Skill 译站把 skills CLI 装出的技能整理成「仓库 → 子技能」的本地知识库:来源归属清清楚楚,左原文右中文逐段对照,中文概述与分类帮你选对要用的那一个。只读技能目录,不安装、不卸载。
- **CTA**:「↓ 下载桌面版」(主按钮 → Releases latest)/「GitHub 查看源码」(幽灵按钮 → 仓库)
- **信任徽章**(✓ 图标三枚):MIT 免费开源 · 密钥系统级加密 · 本地扫描,无账号、无遥测

**CSS 界面模拟图**(纯 HTML/CSS 仿真窗口,不用真截图,避免泄露本机清单;数据取自 `seeds/summaries.json` 真实内容):

- 窗口标题栏:三点 + logo 缩略 + 「Skill 译站 · 中英对照学习」
- 工具条:假搜索框「搜索技能、概述、分类…」+ 分类胶囊:`全部 27` `工程流程 12` `写作 3(选中态)` `前端开发 4` `调试 1`
- 左侧仓库树:`▾ mattpocock/skills(23)`(子项 ask-matt / codebase-design / code-review / **grill-me(选中)** / handoff / teach / tdd / …);`▸ vercel-labs/skills(1)` `▸ ui-ux-pro-max-skill(2)` `▸ flyai-skill(1)`
- 右侧阅读区:文档头 `grill-me` + 分类徽章「工程流程 · 写作」;概述行「用有针对性的问题追问用户,把模糊的想法打磨成清晰、可实施的规格。」;**双栏对照**——左 EN(两段灰蓝)右 ZH(两段深色),段行对齐;底部深色代码条 `npx skills add mattpocock/skills` + 绿徽章「代码原样保留」
- 状态栏(等宽小字):`23 个工具根 · 27 个技能 · 已归属 25 · 待确认 2 · 译文已缓存`

### 2. 它解决什么问题(`#why`)

小标「WHY」/ H2「装得越多,越读不过来」/ 引导:skills CLI 把一个仓库的几十个子技能平铺装进本地目录,又被多个工具根共享。时间一长——

三张玻璃卡(图标 + 痛点 + 「→ 译站」解法行,解法行主色加粗前缀):

| 卡 | 痛点 | → 译站 |
| --- | --- | --- |
| 📖 读不懂 | SKILL.md 几乎全是英文,几十篇逐个啃,读到一半就放弃 | 左原文右中文,逐段对照,边读边学 |
| ❓ 来源不明 | 技能文件夹混装,说不清哪个属于哪个仓库、是谁装进来的 | lock 归属引擎精确归属,推断必标注 |
| 🧩 重复混乱 | 同一技能在 `.claude`、`.zcode`、`.agents` 多处出现,像装了好几份 | 真实路径合并、拷贝计数、分岔多版本 |

### 3. 核心特性(`#features`)——六卡网格(3×2)

小标「FEATURES」/ H2「一个只读的本地知识库」/ 引领:读得懂、找得到、归属清楚。

| # | 卡 | 图标/色 | 文案 |
| --- | --- | --- | --- |
| 1 | 块级中英对照 | 双栏/主蓝 | 左原文右译文逐段对齐;代码块、命令、URL、路径先摘出、译后回填,永不被改写;中文文档单栏直出。 |
| 2 | **分类速查(新增)** | 标签/紫 | 不知道该调用哪个 Skill?中文概述一句话讲清「它是什么、什么时候用」;点分类胶囊或卡片标签,工程流程、写作、调试……即刻筛出候选,与搜索、仓库分组同页联动。内置种子覆盖常用技能,配置 LLM 自动补全其余。 |
| 3 | lock 归属引擎 | 锚/绿 | 优先读 skills CLI 安装清单 `.skill-lock.json`;无记录时回退 `.git` 远端、frontmatter、LLM 推断,推断必标注「待确认」;手动归组最高优先。 |
| 4 | 多根去重 | 层叠/琥珀 | junction/symlink 按真实路径合并;内容一致的独立拷贝合并并计数;同名分岔展示为多个版本。 |
| 5 | 翻译学习友好 | 计时/青 | 打开才翻、未变不重翻、并发只翻一份;超长文档自动分块、全局节流;附属文档按需翻译。 |
| 6 | 桌面 + 网页双形态 | 显示器/玫红 | Windows 桌面版免 Node、托盘常驻;网页版 `node server.js` 即起;同一套界面与 API 契约。 |

### 4. 兼容(`#compat`)

H2「认得出 23 个工具根」/ 引导:技能装进每个工具自己的目录,译站只读不改;同一技能多处出现时自动合并归属。

胶囊网格(等宽字体,23 枚):`.claude` `.agents` `.zcode` `.codex` `.cursor` `.gemini` `opencode` `windsurf` `goose` `crush` `continue` `roo` `copilot` `factory` `kiro` `augment` `agents` `qwen` `trae` `trae-cn` `qoder` `codebuddy` `iflow`

下注说明条(🔒 图标):优先读取 [vercel-labs/skills](https://github.com/vercel-labs/skills) 安装清单 `.skill-lock.json`,归属最准;没有记录时逐级推断并标注来源。以上为默认扫描根,可在 `config.json` 的 `roots` 自定义。

### 5. 安全与隐私(`#security`)

H2「安全与隐私优先」。四卡:

| 卡 | 文案 |
| --- | --- |
| 🔐 密钥加密 | 只在设置页录入,经 OS 凭据库(DPAPI/Keychain/secret-tool)+ AES-256-GCM 加密落盘;界面与接口只回掩码;可随时清除。 |
| 🏠 只在本机 | 默认只监听 127.0.0.1;所有写入请求强制同源校验,跨站伪造一律 403。 |
| ✉️ 外发需同意 | 翻译开启前必须明确同意;LLM 可选,启用才发送;不配置时除翻译外零外发。 |
| 🛡️ 只读不改 | 不安装、不卸载、不改写任何技能文件;扫描、去重、搜索全部本地完成。 |

### 6. 常见问题(`#faq`,原生 `<details>` 手风琴,单开)

1. **不配置翻译和 LLM,能用吗?** 能。浏览、归属、去重、搜索全部可用;中英对照需配置翻译服务;概述与分类对常用技能有内置种子,配置 LLM 后自动补全其余。
2. **API key 存在哪里?安全吗?** 经 OS 凭据库 + AES-256-GCM 加密后落盘,任何文件没有明文;界面只显示掩码(前3***后4);凭据复制到其他机器无法解密,可随时清除。
3. **会改动我的技能文件吗?** 不会。只读扫描技能目录;手动归组等操作只写在自己的数据目录里。
4. **分类标签从哪里来?** 内置种子覆盖 vercel-labs/skills 等常用技能;配置 LLM 后自动为无种子的技能生成中文概述与 1-3 个分类标签;点技能卡上的标签即可筛选。
5. **桌面版支持 macOS / Linux 吗?** 桌面安装包目前仅 Windows;网页版(Node ≥ 20)跨平台,密钥在 macOS/Linux 走 Keychain / secret-tool。
6. **翻译怎么计费?** 走 UApiPro AI 翻译接口,每次调用 4 积分;超长文档自动分块,按调用次数计;内容未变不重复调用,同一文档并发只翻一份。

### 7. 下载(`#download`)

H2「下载 Skill 译站」/ 版本行:v0.1.0 · MIT · Windows 桌面版 + 跨平台网页版。两张玻璃卡:

- **桌面版(Windows,推荐)**:要点「安装版 setup.exe / 便携版 portable.exe」「默认托盘常驻,关窗最小化」「WebView2 系统一般自带」→ 主按钮「前往 GitHub Releases」。底部琥珀提示条:安装包未做代码签名,Windows 可能提示「未知发布者」,选择「仍要运行」即可。
- **网页版(源码运行)**:Node.js ≥ 20,零 npm 依赖。深色代码块(右上复制按钮,点击后变「已复制 ✓」):
  ```bash
  git clone https://github.com/TurkeyPro1025/skill_viewer.git
  cd skill_viewer
  node server.js
  ```
  下一行:打开 `http://127.0.0.1:4763` 即用。

### 8. 页脚

品牌区(logo + 一句话「把装进来的 Skill,整理成读得懂的本地知识库。」)+ 三列:产品(为什么/特性/兼容/下载/常见问题锚点)· 源码(GitHub/Releases/Issues)· 文档(README/CONTRIBUTING/LICENSE,链 GitHub blob)。
版权条:© 2026 Skill 译站 · MIT License · 只读工具,不安装、不卸载。

## 5. 交互与动效

- 导航吸顶玻璃;`IntersectionObserver` 滚动高亮当前锚点。
- 卡片 hover:`translateY(-2px)` + 边框加深 + 阴影弹层,120ms ease。
- FAQ:`<details>` 原生展开,`+` 号旋转 45° 成 `×`;同组单开。
- 复制按钮:`navigator.clipboard`,`file://` 下回退 `execCommand`;成功态 1.6s。
- 平滑滚动 `scroll-behavior: smooth`;`prefers-reduced-motion` 全部关闭。

## 6. 响应式与可访问性

- **≥1080**:设计满宽;**900–1079**:特性 3→2 列、模拟图隐藏左树;**640–899**:全单列,Hero 标题 `clamp()` 缩放,对照双栏改上下堆叠(原文上/译文下,保留栏头);**<640**:导航收成 logo+下载,锚点横向滚动。
- 对比度:正文 `#17233a` on `#e9eef6` ≥ 12:1;次级 `#52607a` ≥ 5:1;主按钮白字 on `#2563eb` ≥ 4.5:1。
- `skip-link` 跳主内容;模拟图加 `role="img"` + aria 描述;focus 可见(主色 2px 外环);`lang="zh-CN"`、`color-scheme: light`。

## 7. 文件与部署(实施时)

```
site/
  index.html   # ~400 行,含 OG/meta/favicon
  style.css    # ~750 行,独立令牌(复制自应用浅色主题,不跨目录 @import)
  app.js       # ~50 行:复制 / 滚动高亮 / FAQ 单开
  logo.png     # 复制自 public/logo.png(128,兼作 favicon)
.github/workflows/pages.yml   # push main → 部署 site/ 到 Pages(风格仿 ci.yml,带中文注释)
```

- Pages 地址将为 `https://turkeypro1025.github.io/skill_viewer/`;需在仓库 Settings → Pages 把 Source 切到 **GitHub Actions**(一次性,手动)。
- **README 暂不加官网链接**,Pages 启用后再补(避免死链)。
- `site/` 不进 `npm test` 扫描,与 CI 无冲突;不自动 commit。

## 8. 验收清单

- [ ] 1440px 与 390px 两档截图:布局、玻璃效果、对照双栏堆叠、导航收纳
- [ ] 全部锚点可平滑滚到,滚动高亮正确
- [ ] 六特性卡文案与 README 口径一致(尤其「分类速查」= 种子 + LLM 补全)
- [ ] FAQ 单开、复制按钮反馈、`file://` 与 http 下均正常
- [ ] 链接逐一点验:Releases latest / 仓库 / Issues / blob 文档链
- [ ] `npm test` 不受影响;`backdrop-filter` 降级与 reduced-motion 生效

---

## 附:README 已完成的配套改点(2026-10-19)

1. 顶部 blockquote 补「不知道该调用哪个时,中文概述与分类筛选帮你快速选对」;
2. 「它解决什么问题」痛点列表新增第四条 **不会选用**;
3. 「一次扫描就能」列表新增「按用途分类浏览(工程流程、写作、调试、调研……),配合中文概述快速选对要调用的技能」;
4. 「核心」卖点新增 **分类选型** 条(置于「块级中英对照」之后):不知道该调用哪个 Skill?中文概述讲清「是什么、什么时候用」,1-3 个中文分类标签点击即筛,与搜索、仓库分组同页联动;内置种子覆盖常用技能,配置 LLM 后自动补全。
