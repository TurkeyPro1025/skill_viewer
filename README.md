# Skills 译站 · 轻量 Skill 翻译学习库

> 把 skills CLI 装出的几十个技能整理成“**仓库 → 子技能**”的本地知识库，并把英文文档译成中文逐段对照——边读边学；不知道该调用哪个时，中文概述与分类筛选帮你快速选对。只读技能目录，不安装、不卸载。

## 它解决什么问题

[vercel-labs/skills](https://github.com/vercel-labs/skills) 等 CLI 会把一个Skill仓库的几十个子技能平铺装进本地目录，还会被 `.agents` / `.zcode` / `.claude` 等多个工具根共享。时间一长：

- **读不懂**：SKILL.md 几乎全是英文，逐篇啃很吃力；
- **来源不明**：技能文件夹混在一起，不知道哪个属于哪个仓库；
- **重复混乱**：同一技能在多个工具根出现，看起来像装了好几份；
- **不会选用**：几十个技能摆在那里，要用时想不起来哪个是干什么的、该调用哪个。

Skills 译站 一次扫描就能：

- 翻译：左原文、右中文逐段对照，边读边理解；
- 按用途分类浏览（工程流程、写作、调试、调研……），配合中文概述快速选对要调用的技能；
- 把技能精确归属到来源仓库：优先读安装清单；没有记录时逐级推断，并明确标注“推断/创作上游”；
- Agent读取情况：看清哪些工具根在生效、哪些是拷贝、哪些内容分岔；
- 支持手动归类技能，或确认自动推断的结果。

## 核心

- **块级中英对照**：左原文右译文逐段对齐；代码块、命令、URL、路径、环境变量先摘出、译后回填，不会被改写；中文原文单栏直出。
- **分类选型**：不知道该调用哪个 Skill？中文概述一句话讲清“它是什么、什么时候用”；1-3 个中文分类标签（工程流程、写作、调试……）点击即筛，与搜索、仓库分组同页联动。内置种子覆盖常用技能；配置 LLM 后自动为其余技能补全概述与分类。
- **翻译学习友好**：中文概述、搜索与分类在同一页；附属文档打开时才翻译，英文入口文档只在你点「手动更新」时预翻；内容未变不重复调用；同一文档并发只翻一份；超长文档自动分块并全局节流。
- **lock 归属引擎**：优先读 skills CLI 安装清单 `.skill-lock.json`；没有记录时按优先级逐级回退到 `.git` 远端、frontmatter 来源（标注“创作上游”）和 LLM 推断（标注“待确认”）；手动归组永远最高优先级。
- **多根去重**：junction/symlink 按真实路径合并；内容一致的独立拷贝合并并计数；同名分岔展示为多个版本。
- **双形态**：网页版（Node ≥ 20）与桌面版（免 Node、托盘常驻）共用同一套界面与 API 契约，**默认指向同一数据目录**（Windows 为 `%APPDATA%\skills-lingo`）——一端翻译过的文档，另一端打开即有译文，无需任何配置。想分开存放或自定义位置时，用 `config.json` 的 `dataDir` 覆盖即可。

## 安装与使用

### 桌面版（推荐，暂仅支持Windows）

从 [GitHub Releases](https://github.com/TurkeyPro1025/skills-lingo/releases/latest) 下载：

- 安装版：`Skills Lingo_<版本>_x64-setup.exe`。

以 Releases 页面实际文件名为准。默认托盘常驻：点关闭最小化到托盘，托盘右键退出；开机自启与“关闭即退出”可在设置页开启。安装包未做代码签名，Windows 可能提示“未知发布者”，选择“仍要运行”即可。

### 网页版（源码运行）

前置：[Node.js](https://nodejs.org/) ≥ 20（零 npm 依赖，无需 `npm install`）。

```bash
git clone https://github.com/TurkeyPro1025/skills-lingo.git

node server.js
```

### 从源码构建桌面版（可选）

适用于想自行修改或重新打包的开发者。需要 Node ≥ 20、Rust 工具链与 Tauri 2 的 Windows 构建依赖（见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)）；在 `desktop/` 下执行：

```bash
cd desktop
npm install
npx tauri build
```

产物：`desktop/target/release/skill-viewer-desktop.exe` 与 `desktop/target/release/bundle/nsis/` 下的安装包。构建与测试约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 配置翻译与 LLM

右上角 **⚙ 设置**：

- **翻译服务**：使用 UApiPro 云翻译服务。粘贴 API key → 「测试连通（免费）」→ 保存，即可开启中英对照（每次调用 4 积分；超长文档会分块，按调用次数计。首次使用会弹出隐私确认）；
- **LLM 服务**：选预设（DeepSeek / 智谱 GLM / 自定义 OpenAI 兼容）→ 填 key → 「测试连通」→ 保存，可生成中文概述与归属推断。

### 常用参数

```bash
node server.js --port 4763 --host 127.0.0.1 --config config.json --no-scan
```

## 安全与隐私

**API key（必读）**

- 只在设置页录入，经 **OS 凭据库（Windows DPAPI / macOS Keychain / Linux secret-tool）+ AES-256-GCM** 加密后落盘，任何文件中都没有明文；
- 永不以明文回传浏览器：界面和所有接口只返回掩码（长 key 为 `前3***后4`，短 key 显示更少）；
- 凭据文件复制到其他机器或用户后无法解密；可随时在设置页「清除已存」。

**本地 API**

- 默认只监听 `127.0.0.1`；不要用 `--host` 或 `config.json` 的 `host` 改成 `0.0.0.0`，那会把只读接口暴露到局域网；
- 所有状态变更请求（POST）强制**同源校验**：伪造 Host/Origin 的跨站写入与 DNS rebinding 一律拒绝（403）；
- 任何接口的响应都不含完整 key；缓存、索引、状态文件中同样没有明文。

**文档内容**

- **翻译**：开启中英对照前必须明确同意；未同意时不发起新的翻译请求，但本地已缓存的译文仍可查看。同意后发送你打开的文档正文；点「手动更新」时，在已同意并配置翻译服务的前提下，会预翻译所有英文入口 SKILL.md。
- **LLM**：保存并启用 LLM 后，分析过程会把无概述技能的 frontmatter 描述与正文前 3000 字符、无归属技能的 SKILL.md 前 4000 字符发送给你配置的 LLM 服务；启动时即可能发生，不限于已打开的文档，且没有单独的同意弹窗。
- 代码块、命令、路径、环境变量在发送前先摘出，翻译不会改写这些片段。
- 扫描、去重、搜索全部在本地完成；不配置 LLM 时，除翻译外无任何外发。

## 配置（可选）

`config.json` 全部字段有默认值，`~` 会展开为用户目录。把 `config.example.json` 复制为启动目录下的 `config.json` 即生效：

| 字段 | 说明 |
| --- | --- |
| `port` / `host` | 监听端口与地址，默认 `4763` / `127.0.0.1` |
| `roots` | 技能根目录列表，按真实路径去重扫描 |
| `lockFiles` | 安装清单文件列表 |
| `dataDir` | 数据目录：索引/概述/译文/手动归组，以及加密凭据 `credentials.enc`、`providers.json`、`state.json` |
| `providers.translate` | 翻译服务端点与参数（密钥不在此，走加密存储） |

## 参与开发

架构、扩展点与测试约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT
