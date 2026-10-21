# 贡献指南

感谢参与!本项目有两个核心扩展点,也是最欢迎贡献的方向。

## 开发环境

```bash
git clone https://github.com/TurkeyPro1025/skills-lingo.git && cd skills-lingo
node server.js          # 直接跑,零依赖
npm test                # 黑盒测试:fixture 技能树 + stub provider,不需要任何真实 API key
```

要求 Node ≥ 20。测试只通过 **HTTP API 黑盒**断言(spec 的测试决策),请在新增功能时保持这条纪律:不断言模块内部实现细节,只断言 API 响应与缓存文件产物。

## 构建桌面安装包

桌面版是 Tauri 2 应用,服务层由 Rust 重实现并内嵌 `public/`。需要 Rust 工具链与 Tauri 的 Windows 构建依赖(WebView2、NSIS 等,见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):

```bash
cd desktop
npm install
npx tauri build
```

产物为 `desktop/target/release/bundle/nsis/` 下的安装包。

## 扩展点一:注册新的安装清单识别器

你的工具链用了别的安装器(不是 vercel-labs skills CLI)?为它的 lock/manifest 文件写一个识别器,零改动核心:

```js
// lib/attribution/recognizers/my-lock-reader.js
module.exports = {
  name: 'my-installer-lock',
  canRead(raw) {
    return Boolean(raw && raw.format === 'my-installer/v1');
  },
  parse(raw) {
    // 返回规范条目:{ <技能文件夹名>: { repo, sourceUrl?, group?, ... } }
    const entries = {};
    for (const item of raw.installed) {
      entries[item.folder] = { repo: item.repository };
    }
    return entries;
  },
};
```

然后在 `lib/analyze.js` 的 `buildEngine` 里 `engine.registerManifestReader(require(...))`,并把清单文件路径加进 `config.json` 的 `lockFiles`。引擎会依次尝试已注册的 reader,谁认出格式谁解析。

参考实现:`lib/attribution/recognizers/lock-reader.js`(skills CLI v3)。

## 扩展点二:贡献新的 provider

**翻译 provider**(接口见 `lib/translate/uapipro.js`):

- 实现 `configured()` 与 `translateText(text) → { text, credits }`(单次调用 ≤ 10k 字符由调用方保证);
- 节流/限速建议在 provider 内部实现(参考 `createThrottle`);
- 在 `lib/config.js` 的 DEFAULTS 与 `config.example.json` 里补默认配置,**API key 只能走网页设置页的加密存储**。

**LLM provider**(接口见 `lib/llm/provider.js`):OpenAI 兼容已覆盖 DeepSeek/GLM/通义等大多数服务;新协议实现 `chat(messages)` 与 `chatJson(messages)` 即可被概述生成与归属推断两条链路复用。

其他约定:

- UI 与服务之间**只通过 HTTP JSON API 通信**(Node 版与桌面壳共用同一前端),前端保持零构建、零 CDN 依赖。
- **密钥安全**(`lib/credentials.js` / `desktop/src/credentials.rs`):网页设置页保存的 API key 经 OS 凭据库主密钥 + AES-256-GCM 加密落盘;新增任何需要密钥的 provider 时,密钥读取必须走加密存储,严禁明文落盘或明文回传 API;状态变更端点必须经过同源校验。
- **双实现同步**:服务层有 Node(`lib/`)与 Rust(`desktop/src/`)两份实现,共享同一 API 契约与缓存/凭据文件格式。改契约或文件格式时**两边都要改**,并跑两套测试(见下);新扩展点先在 Node 侧落地,Rust 侧跟进移植。
- 中文优先:界面与文档文案用中文,代码注释说明"为什么"。
- 提交前 `npm test` 全绿(涉及 Rust 侧再跑 `SKILLS_LINGO_TEST_IMPL=rust npm test`);涉及真实外部服务的行为改动,请在 stub 里同步模拟。
- 种子概述数据在 `seeds/summaries.json` 维护,不硬编码在代码里;欢迎为更多知名仓库补充人工概述。LLM 预设在 `lib/llm/presets.json`,欢迎补充新服务商。

## 测试

```bash
npm test                                  # Node 实现(28 项,回退线,始终保留)
SKILLS_LINGO_TEST_IMPL=rust npm test      # Rust 实现(spawn desktop --serve,27 项 + 1 白盒跳过)
```

## UI 手动验收清单

UI 不设自动测试缝,改前端后请过一遍:

1. 首页渲染:分组/卡片/徽章/分类筛选/搜索/空态;
2. 查看器:英文文档左右对照、块对齐滚动;中文文档单栏;侧栏切换附属文档;图片内联;
3. 隐私弹窗:首次翻译出现、同意后不再骚扰、ⓘ 可回看;
4. 整理归属:多选、归入仓库、移入未知、确认推断,重新分析后保留;
5. 手动更新:进度条出现并结束,内容未变时积分不涨。
