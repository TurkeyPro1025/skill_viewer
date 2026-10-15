# skill-viewer · 轻量 Skill 全览

> 把 `skills` CLI 装出来的几十个技能整理成"**仓库 → 子技能**"的知识库,可搜索、可归类,还能**左英右中逐段对照**阅读英文文档。只读,不管理。

[English intro below](#english-intro)

## 它解决什么问题

用 [vercel-labs/skills](https://github.com/vercel-labs/skills) CLI 装几个知名技能仓库(一个仓库平铺装出几十个子技能文件夹)之后:

- 50 多个技能文件夹混在一起,**哪个属于哪个仓库完全不可见**;
- SKILL.md 几乎全是英文,**逐篇阅读很吃力**;
- 同一技能被 junction/symlink 链到 `.agents` / `.zcode` / `.claude` 等多个工具根目录,**看起来像装了三份**。

skill-viewer 是一个 **Node 单文件本地服务 + 网页 UI**(零 npm 依赖,Node ≥ 20),启动即扫描分析,只读不安装不卸载。同时提供 **Tauri 2 桌面版**(Windows,深蓝玻璃拟态 UI,详见下文「桌面版」)。

## 核心卖点:lock 归属引擎

归属引擎不靠猜——**优先读 skills CLI 的安装清单 `.skill-lock.json`**,把每个技能精确归属到来源仓库(含仓库内分组);瀑布式补充 `.git` remote、frontmatter URL(明确标注"创作上游"而非安装来源)、LLM 读正文推断(标注"推断"待你确认),手动归组优先级最高:

```
overrides(手动) → .skill-lock.json → .git remote → frontmatter URL(创作上游) → LLM 推断 → 未知来源
```

引擎是独立模块,清单格式识别器与归属来源识别器均为**注册表式扩展点**(见 [CONTRIBUTING.md](CONTRIBUTING.md))。

其余特性:

- **多根去重**:解析 junction/symlink 按真实路径合并;内容一致的独立拷贝合并;同名内容分岔的展示为两个版本;卡片显示"在哪些工具根目录生效"徽章。
- **块级对照阅读**:Markdown 解析为内容块(标题/段落/列表/引用/表格),左侧原文右侧译文一一对应;代码块、行内代码、URL、路径、环境变量**占位摘出、译后回填,绝不被改写**;中文原文单栏直出不翻译。
- **积分友好**:入口 SKILL.md 仅在你显式点「**手动更新**」时批量预翻(知情、按需);启动、同意隐私、保存设置都不预翻,打开哪个文档才翻哪个;附属文档首次打开才翻;多个内容块拼满单次字符上限(约 9900/万)省调用;同一文档并发请求只翻一份;全部结果按**内容哈希**增量缓存,内容未变**永不重复调用**;4 QPS 自动节流。
- **隐私优先**:首次翻译前明确提示"文档内容将上传 uapis.cn";API key 加密存储(见下),任何文件中都无明文;提示与积分消耗随时可在右上角 ⓘ 回看。
- **概述与分类**:知名仓库用人工种子中文概述(开箱即有);其余可接任意 OpenAI 兼容 LLM(DeepSeek/GLM…)按统一格式生成;来源归组与分类标签是两套独立数据;LLM 未配置时优雅降级为原文描述。
- **手动整理**:多选技能归入任意仓库或"未知来源",一键确认 LLM 推断;重新分析永不覆盖手动结果。
- **深蓝玻璃拟态 UI**:Win11 Mica 风格双主题(跟随系统,可手动切深/浅),紧凑密度、键盘导航(j/k 移动、Enter 打开、`/` 聚焦搜索、查看器内 `[` `]` 切文档)、文档路径面包屑。

## 快速开始

```bash
# 无需安装任何依赖
node server.js
# 打开 http://127.0.0.1:4763
```

默认扫描 `~/.agents/skills`、`~/.zcode/skills`、`~/.claude/skills`,读 `~/.agents/.skill-lock.json`。自定义见 `config.example.json`(复制为 `config.json` 即生效)。

### 配置翻译与 LLM(都在网页设置页)

打开 http://127.0.0.1:4763 → 右上角 **⚙ 设置**:

- **翻译服务(UApiPro)**:粘贴 API key → 「测试连通(免费)」验证 → 保存。测试走免费探针,另可选「完整测试」(发送 1 字符真实翻译,消耗 4 积分,结果 100% 确定)。
- **LLM 服务**:预设下拉(**DeepSeek / 智谱 GLM / 自定义**任意 OpenAI 兼容服务)→ API 地址随预设自动锁定 → 填 key → 「测试连通」(自动拉取可用模型列表填入下拉)→ 保存后自动按新配置增量分析。

密钥保存后以 **OS 凭据库 + AES-256-GCM** 加密落盘(Windows DPAPI / macOS 钥匙串 / Linux secret-tool,均不可用时回退机器绑定加密),任何文件中都无明文,也永不以明文回传浏览器(只显示掩码);可随时「清除已存」。**本项目不读环境变量**,配置统一在设置页管理,行为与认知一致。

翻译走 [uapis.cn](https://uapis.cn) AI 翻译接口(4 积分/次、4 QPS、单次 1 万字符,本项目自动分块+节流)。首次翻译会弹出隐私提示,同意后才会把文档原文发送到该服务。

不配置 LLM 时全部功能可用,概述降级为 frontmatter 原文描述、不做归属推断;LLM 推断仅在高置信度时自动纳入仓库分组,中/低置信度作为候选保留在未知来源,可一键确认。

### 常用参数

```bash
node server.js --port 4763 --host 127.0.0.1 --config config.json --no-scan
```

## 桌面版(Tauri 2 · Windows)

`desktop/` 是同一产品的 Tauri 2 桌面版:**前端 `public/` 一份代码双端复用,HTTP API 契约完全一致**;Node 版服务已逐模块移植为 Rust(scanner / 归属瀑布 / 翻译管线 / DPAPI+AES-256-GCM 凭据 / 分析编排),凭据文件格式与 Node 版互通。

```bash
cd desktop
npm i                 # 仅装 tauri CLI(构建工具,不进运行时)
npx tauri build       # 产出 NSIS 安装包 + 单文件 exe
```

特性:系统托盘常驻(默认关窗最小化到托盘,设置可切「关闭即退出」)、开机自启(登录后 `--hidden` 静默驻留)、单实例(二次启动聚焦已有窗口)、数据目录 `%APPDATA%\skill-viewer`。桌面专属设置在网页 ⚙ 设置的「桌面」区,走本机 HTTP API(`/api/desktop-settings`)。

无窗口服务模式(测试/高级用法):`skill-viewer.exe --serve [--port N] [--config config.json]`,不自动分析。

## 测试

```bash
npm test                              # node --test,fixture 技能树 + stub provider,不打真网、不需要任何真实 key
# 同一套 28 项黑盒测试驱动 Rust 实现(spawn desktop --serve):
cd desktop && cargo build
cd .. && SKILL_VIEWER_TEST_IMPL=rust npm test
```

Node 版始终保留作为回退线;两种实现的凭据/缓存文件格式互通(测试里 Node 预写加密密钥、Rust 直接解密使用)。

## 配置说明

`config.json`(可选,全部字段有默认值,`~` 会展开为用户目录):

| 字段 | 说明 |
| --- | --- |
| `roots` | 技能根目录列表,按真实路径去重扫描 |
| `lockFiles` | 安装清单文件列表(默认 skills CLI 的 `.skill-lock.json`) |
| `dataDir` | 缓存目录(索引/概述/译文/overrides,全部 JSON) |
| `providers.translate` | 翻译服务端点与调用参数(密钥不在此,走加密存储) |
| `providers.llm` | LLM 服务默认地址/模型(实际配置在设置页,存 providers.json) |

缓存键 = 技能真实路径 + 内容哈希;技能升级(哈希变化)自动重新生成概述与入口译文,未变化的永不重复调用。

## 隐私说明

- 翻译会把**所浏览文档的原文**发送到配置的外部翻译服务(默认 uapis.cn);代码块/命令/路径/环境变量先摘出再翻译。
- LLM 概述与归属推断会把 SKILL.md 内容发送到你配置的 LLM 服务;不配置则完全不发送。
- **API key 安全**:密钥只在网页设置页录入,经 OS 凭据库(Windows DPAPI / macOS 钥匙串 / Linux secret-tool,不可用时回退机器绑定密钥)+ AES-256-GCM 加密后落盘,任何文件中都无明文;密钥永不以明文回传浏览器(只显示掩码)。凭据文件复制到其他机器/用户后无法解密。
- 本地 API 对状态变更请求做同源校验,浏览器里的其他网页无法跨站写入你的配置。
- 首次翻译前的提示与累计积分消耗,随时可在页面右上角 ⓘ 查看。

## 范围(v1 不做)

安装/卸载/同步管理、插件缓存技能展示、英中以外语言对。(桌面打包已完成,见「桌面版」。)

## English intro

**skill-viewer** is a lightweight, read-only local knowledge base for [agent skills](https://github.com/vercel-labs/skills). A single-file Node service (zero npm dependencies, Node ≥ 20) plus a web UI that:

- Scans multiple skill roots (`.agents` / `.zcode` / `.claude` …), resolves junctions/symlinks, and dedupes by real path — identical copies merge, diverged forks show as versions.
- **Attribution engine (the headline feature)**: maps every skill back to its source repo via a waterfall — installer lock file (`.skill-lock.json`) → `.git` remote → frontmatter URL (labelled "creative upstream") → optional LLM inference → manual grouping (highest priority). Registry-based, easy to extend with new manifest formats.
- Bilingual reading: block-aligned English/Chinese side-by-side with code, commands, URLs and paths protected by placeholders; Chinese originals render single-column untranslated.
- Credit-friendly: batched multi-block calls, 4-QPS throttling, lazy translation for attached docs, and content-hash incremental caching — unchanged documents never hit the API again.
- Privacy-first: explicit consent before any document leaves your machine; API keys are stored encrypted (OS credential store + AES-256-GCM).
- Desktop edition: a Tauri 2 build ships the same UI and an HTTP-API-compatible Rust port of the service, with tray, autostart and an NSIS installer — one `public/` frontend serves both editions.

Run `node server.js` and open http://127.0.0.1:4763. See [CONTRIBUTING.md](CONTRIBUTING.md) for the two extension points (manifest recognizers & providers).

## License

MIT
