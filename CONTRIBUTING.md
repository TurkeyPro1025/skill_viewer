# Contributing · 贡献指南

**English** | [中文](#中文)

Thanks for contributing! This project has two core extension points, and they are the most welcome places to start.

## Development environment

```bash
git clone https://github.com/TurkeyPro1025/skills-lingo.git && cd skills-lingo
node server.js          # run directly, zero dependencies
npm test                # black-box tests: fixture skill tree + stub provider, no real API key needed
```

Node ≥ 20 is required. Tests assert only through the **HTTP API black box** (the testing decision in the spec). Keep that discipline when adding features: do not assert internal module details — assert API responses and cache-file artifacts.

## Building the desktop installer

The desktop app is a Tauri 2 application; its service layer is reimplemented in Rust and embeds `public/`. It requires the Rust toolchain and Tauri's Windows build dependencies (WebView2, NSIS, etc. — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):

```bash
cd desktop
npm install
npx tauri build
```

The installer is written under `desktop/target/release/bundle/nsis/`.

## Extension point 1: register a new install-manifest recognizer

Does your toolchain use a different installer (not the vercel-labs skills CLI)? Write a recognizer for its lock/manifest file — no changes to the core:

```js
// lib/attribution/recognizers/my-lock-reader.js
module.exports = {
  name: 'my-installer-lock',
  canRead(raw) {
    return Boolean(raw && raw.format === 'my-installer/v1');
  },
  parse(raw) {
    // Return canonical entries: { <skill folder name>: { repo, sourceUrl?, group?, ... } }
    const entries = {};
    for (const item of raw.installed) {
      entries[item.folder] = { repo: item.repository };
    }
    return entries;
  },
};
```

Then call `engine.registerManifestReader(require(...))` in `buildEngine` in `lib/analyze.js`, and add the manifest path to `lockFiles` in `config.json`. The engine tries each registered reader in order; whichever recognizes the format parses it.

Reference implementation: `lib/attribution/recognizers/lock-reader.js` (skills CLI v3).

## Extension point 2: contribute a new provider

**Translation provider** (interface: `lib/translate/uapipro.js`):

- Implement `configured()` and `translateText(text) → { text, credits }` (the caller guarantees ≤ 10k characters per call);
- Implement throttling/rate limiting inside the provider (see `createThrottle`);
- Call `uapis.cn` with Node `fetch`: curl intermittently receives a 524 from its edge while the same request succeeds from Node;
- Add defaults to `DEFAULTS` in `lib/config.js` and to `config.example.json`. **API keys may only be stored through the encrypted storage behind the settings page.**

**LLM provider** (interface: `lib/llm/provider.js`): the OpenAI-compatible implementation already covers DeepSeek, GLM, Qwen and most other services. A new protocol only needs `chat(messages)` and `chatJson(messages)` to be reused by both summary generation and attribution inference.

Other conventions:

- The UI and the service communicate **only through the HTTP JSON API** (the Node and desktop shells share the same frontend). The frontend stays build-free and CDN-free.
- **Key security** (`lib/credentials.js` / `desktop/src/credentials.rs`): API keys saved from the web settings page are encrypted to disk with an OS credential-store master key plus AES-256-GCM. Any new provider that needs a key must read it from encrypted storage — never write plaintext or return it from an API. State-changing endpoints must enforce same-origin checks.
- **Keep both implementations in sync**: the service layer exists twice — Node (`lib/`) and Rust (`desktop/src/`) — sharing the same API contract and cache/credential file formats. When you change a contract or file format, **change both sides** and run both test suites (see below). Land new extension points in Node first, then port them to Rust.
- **Bilingual copy**: interface and documentation copy is bilingual (Chinese + English), with English as the international release surface. New user-visible UI strings must go through locale entries (the language-pack system lands in v1.2.0) — do not hardcode copy. Code comments explain "why". Static site/document copy can be drafted with the one-time batch tool in `scripts/translate-copy.js` (reads `UAPI_KEY` from the environment, protects code/URLs/placeholders, and writes a JSON draft for review).
- Run `npm test` before submitting (and `SKILLS_LINGO_TEST_IMPL=rust npm test` when Rust is involved). For behavior changes that touch real external services, mirror them in the stubs.
- Seed summaries live in `seeds/summaries.json`, not hardcoded in the source. Contributions of hand-written summaries for well-known repositories are welcome. LLM presets live in `lib/llm/presets.json`; new providers are welcome.

## Testing

```bash
npm run check                             # syntax check for every project JS file
npm test                                  # Node API suite (31 tests) + site build checks (13 tests)
SKILLS_LINGO_TEST_IMPL=rust npm test      # the same API suite against the Rust implementation (white-box tests skipped)
```

## UI manual acceptance checklist

The UI has no automated test seam. After changing the frontend, walk through:

1. Home page: groups/cards/badges/category filters/search/empty state;
2. Viewer: English documents in side-by-side mode with aligned scrolling; Chinese documents in a single column; sidebar document switching; inline images;
3. Privacy dialog: appears on first translation, does not reappear after consent, ⓘ reopens it;
4. Attribution: multi-select, assign to repository, move to unknown, confirm inference, all preserved after re-analysis;
5. Manual update: progress bar appears and finishes; credits do not increase when content is unchanged.

## Regenerating the social preview image

The canonical source is `docs/og-image.html` (1200×630). Render it with Chrome headless from the repository root:

```bash
chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --screenshot=site/og-image.png docs/og-image.html
```

`site/og-image.png` is used by both the website's `og:image` and the GitHub social preview. Edit the source, rerender, and run `npm test`.

## Release notes

From v1.1.0 onward, every release uses the bilingual template in [`.github/RELEASE_NOTES_TEMPLATE.md`](.github/RELEASE_NOTES_TEMPLATE.md): English first, Chinese second. Keep the two sections factually identical.

---

# 中文

感谢参与！本项目有两个核心扩展点，也是最欢迎贡献的方向。

## 开发环境

```bash
git clone https://github.com/TurkeyPro1025/skills-lingo.git && cd skills-lingo
node server.js          # 直接跑，零依赖
npm test                # 黑盒测试：fixture 技能树 + stub provider，不需要任何真实 API key
```

要求 Node ≥ 20。测试只通过 **HTTP API 黑盒**断言（spec 的测试决策），请在新增功能时保持这条纪律：不断言模块内部实现细节，只断言 API 响应与缓存文件产物。

## 构建桌面安装包

桌面版是 Tauri 2 应用，服务层由 Rust 重实现并内嵌 `public/`。需要 Rust 工具链与 Tauri 的 Windows 构建依赖（WebView2、NSIS 等，见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)）：

```bash
cd desktop
npm install
npx tauri build
```

产物为 `desktop/target/release/bundle/nsis/` 下的安装包。

## 扩展点一：注册新的安装清单识别器

你的工具链用了别的安装器（不是 vercel-labs skills CLI）？为它的 lock/manifest 文件写一个识别器，零改动核心：

```js
// lib/attribution/recognizers/my-lock-reader.js
module.exports = {
  name: 'my-installer-lock',
  canRead(raw) {
    return Boolean(raw && raw.format === 'my-installer/v1');
  },
  parse(raw) {
    // 返回规范条目：{ <技能文件夹名>: { repo, sourceUrl?, group?, ... } }
    const entries = {};
    for (const item of raw.installed) {
      entries[item.folder] = { repo: item.repository };
    }
    return entries;
  },
};
```

然后在 `lib/analyze.js` 的 `buildEngine` 里 `engine.registerManifestReader(require(...))`，并把清单文件路径加进 `config.json` 的 `lockFiles`。引擎会依次尝试已注册的 reader，谁认出格式谁解析。

参考实现：`lib/attribution/recognizers/lock-reader.js`（skills CLI v3）。

## 扩展点二：贡献新的 provider

**翻译 provider**（接口见 `lib/translate/uapipro.js`）：

- 实现 `configured()` 与 `translateText(text) → { text, credits }`（单次调用 ≤ 10k 字符由调用方保证）；
- 节流/限速建议在 provider 内部实现（参考 `createThrottle`）；
- 调用 `uapis.cn` 请用 Node `fetch`：curl 会间歇收到 524，而同一请求从 Node 发出正常；
- 在 `lib/config.js` 的 `DEFAULTS` 与 `config.example.json` 里补默认配置，**API key 只能走网页设置页的加密存储**。

**LLM provider**（接口见 `lib/llm/provider.js`）：OpenAI 兼容已覆盖 DeepSeek/GLM/通义等大多数服务；新协议实现 `chat(messages)` 与 `chatJson(messages)` 即可被概述生成与归属推断两条链路复用。

其他约定：

- UI 与服务之间**只通过 HTTP JSON API 通信**（Node 版与桌面壳共用同一前端），前端保持零构建、零 CDN 依赖。
- **密钥安全**（`lib/credentials.js` / `desktop/src/credentials.rs`）：网页设置页保存的 API key 经 OS 凭据库主密钥 + AES-256-GCM 加密落盘；新增任何需要密钥的 provider 时，密钥读取必须走加密存储，严禁明文落盘或明文回传 API；状态变更端点必须经过同源校验。
- **双实现同步**：服务层有 Node（`lib/`）与 Rust（`desktop/src/`）两份实现，共享同一 API 契约与缓存/凭据文件格式。改契约或文件格式时**两边都要改**，并跑两套测试（见下）；新扩展点先在 Node 侧落地，Rust 侧跟进移植。
- **双语文案**：界面与文档中英双语，英文为国际发布面；新增界面文案必须走语言包词条（语言包体系随 v1.2.0 落地），禁止硬编码。代码注释说明“为什么”。官网/文档静态文案可用一次性批量工具 `scripts/translate-copy.js` 起草（从环境变量读取 `UAPI_KEY`，保护代码/URL/占位符，输出 JSON 草案供人工校对）。
- 提交前 `npm test` 全绿（涉及 Rust 侧再跑 `SKILLS_LINGO_TEST_IMPL=rust npm test`）；涉及真实外部服务的行为改动，请在 stub 里同步模拟。
- 种子概述数据在 `seeds/summaries.json` 维护，不硬编码在代码里；欢迎为更多知名仓库补充人工概述。LLM 预设在 `lib/llm/presets.json`，欢迎补充新服务商。

## 测试

```bash
npm run check                             # 全项目 JS 语法检查
npm test                                  # Node API 套件(31 项)+ 站点构建检查(13 项)
SKILLS_LINGO_TEST_IMPL=rust npm test      # 同一 API 套件跑 Rust 实现(白盒测试跳过)
```

## UI 手动验收清单

UI 不设自动测试缝，改前端后请过一遍：

1. 首页渲染：分组/卡片/徽章/分类筛选/搜索/空态；
2. 查看器：英文文档左右对照、块对齐滚动；中文文档单栏；侧栏切换附属文档；图片内联；
3. 隐私弹窗：首次翻译出现、同意后不再骚扰、ⓘ 可回看；
4. 整理归属：多选、归入仓库、移入未知、确认推断，重新分析后保留；
5. 手动更新：进度条出现并结束，内容未变时积分不涨。

## 重新生成社交预览图

源文件为 `docs/og-image.html`(1200×630)。在仓库根目录用 Chrome headless 渲染:

```bash
chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --screenshot=site/og-image.png docs/og-image.html
```

`site/og-image.png` 同时用于官网 `og:image` 与 GitHub 社交预览。改完源文件后重新渲染并跑 `npm test`。

## Release Notes

自 v1.1.0 起，每次发版使用 [`.github/RELEASE_NOTES_TEMPLATE.md`](.github/RELEASE_NOTES_TEMPLATE.md) 的双语模板：英文在前，中文在后，两段内容保持一致。
