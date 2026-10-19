# 桌面端同步计划:f411e6b 之后的网页端改动合并到桌面端

日期:2026-10-17。HEAD=f411e6b,工作区有 6+ 轮已验收未提交的网页端改动。
目标:让 Tauri 桌面端(release exe + NSIS 安装包)与网页端工作区现状完全一致,自查完善,全程不改网页端代码,完成后执行 3 分钟延时关机。

## 一、时间线梳理(f411e6b 之后,按记忆与 git diff 交叉核实)

| 轮次 | 内容 | 涉及后端契约? | 桌面端现状 |
|---|---|---|---|
| R1 主题换蓝+交互精简 | 主题绿→蓝(#2563EB)、设置页可读性令牌、UApiPro 官网导购链接、模型选择器 v1、**预设不锁 baseUrl**、密度切换移顶栏、快捷键只留 Ctrl+K、README 全量重写 | ✅ lib/api.js `settings_providers`:用户显式 baseUrl 优先,预设仅默认值 | server.rs 已同步移植(工作区 diff 已含) |
| R2 查验修复+徽章一行适配 | btn-primary hover 白字白底修复、去黑渐变、归属条纹整体移除、对照列头结构性固定(flex 列)、fitRootBadges 一行折叠+flyout | ❌ 纯前端 | 经 public/ 内嵌,重建即同步 |
| R3 模型选择器行为修正 | mergeModelOptions(只增不减) | ❌ 纯前端 | (被 R4 反转,终态以工作区为准) |
| R4 模型下拉三轮定稿 | 候选整体替换、失焦回显、下拉箭头;**lib/connectivity.js `testLlm` models 改返回 `{id,name}` 对象数组** | ✅ | connectivity.rs 已同步移植(含空 id 过滤) |
| R5 frontend-design T1+T2 | 归属条纹(后又删净)、徽章降噪、读数条 #stats-bar、对照列头、代码块悬停复制、空态指引 | ❌ 纯前端 | 经 public/ 内嵌,重建即同步 |
| R6 内联图标+配置目录轮 | ICO_DUMP_TO/ICO_LINK 内联进 app.js、config.example.json roots 3→23、server.rs 加 /dump_to.svg /link.svg 两路由 | ✅(静态路由) | server.rs 已加路由+include_bytes |
| R7 group-summary 去折叠 | 仓库描述点击/拖选不再触发折叠 | ❌ 纯前端 | 经 public/ 内嵌,重建即同步 |

另:test/api.test.js 第 15 项断言改为 `{id,name}` 对象(与 R4 配套),test/helpers.js stub 返回补 name 字段。

## 二、桌面端同步现状盘点(本次核实)

已移植(工作区已改,待验证):
1. `desktop/src/server.rs` `settings_providers`:baseUrl 优先级与 lib/api.js 逐行对齐(用户显式非空地址 > 非 custom 预设地址 > 不写入 patch 保留旧值)。✅ 语义等价
2. `desktop/src/connectivity.rs` `test_llm`:models 映射为 `{id, name|null}` 对象数组,空 id 过滤。与 Node 等价;唯一微差:Node 对空串 name 保留 `""`,Rust 归一为 `null`——前端两者均按 falsy 处理(显示回落 id),行为等价,**决策:不改**(避免无意义 Rust 改动)。
3. `desktop/src/server.rs`:/dump_to.svg、/link.svg 路由 + include_bytes,public/ 两清理版文件已就位。
4. `desktop/src/config.rs` 默认 roots=3 根:与 **Node 代码内置默认**(lib/config.js:11,仍 3 根)一致;config.example.json 的 23 根只是示例文件(用户复制用),**双端代码默认都不跟它走,保持现状**。

未落地(本次主体工作):
- **release exe 与 NSIS 安装包未重建**——include_bytes 内嵌的还是 R1 之前的旧前端。六轮前端改动全部经重建自动同步,无需改 desktop 代码。

## 三、执行步骤(已经子智能体审查修订,2026-10-17)

1. **预检**:`node --test test/`(node 模式 28/28,只跑不改);`cd desktop && cargo check`(构建命令一律在 desktop/ 下执行,根目录无 tauri CLI 依赖,npx 会解析到无关同名包)。
2. **重建**:`cd desktop && npx tauri build`(一次到位:内部先 cargo build --release 再打 NSIS,NSIS 永远打包本次新 exe;无需单独 cargo build)。注意 RUSTUP_HOME/CARGO_HOME=E:\rust\(已实测在位)、NSIS 工具链 %LOCALAPPDATA%\tauri\NSIS 已就位。
3. **Rust 黑盒**:`SKILL_VIEWER_TEST_IMPL=rust node --test test/`(RUST_BIN release 优先,spawn --serve,密钥按相同落盘格式预置)。预期 27 pass + 1 skip(03z 白盒 Node-only)。**顺序依赖:必须在步骤 2 之后**,否则误测旧 exe——不过第 15 项新断言会大声失败,不会假通过。
4. **桌面自查(release --serve 探活)**:
   - 内嵌 index.html:含 `density-toggle`、`llm-model-picker`、`stats-bar`、`model-picker-list` 新标记;不含已删除的 `btn-theme`;含首帧主题锁 `dataset.theme = 'light'`;
   - 内嵌 app.js:含 `ICO_DUMP_TO`/`ICO_LINK`/`fitRootBadges`;
   - GET /logo.png、/api/status → 200 正常;(/dump_to.svg /link.svg 为多余但无害的死路由——图标已内联,探活降级为可选;仓库根游离原件 dump_to.svg/link.svg 是用户遗留物,保留并在总结中点明)
   - **GET /api/desktop-settings**(仅桌面端有的路由,黑盒 0 覆盖,前端必调)→ 200 + JSON;
   - **R1 baseUrl 三连功能探针**(黑盒测试无此用例,rust 二进制上唯一的功能级验证):POST /api/settings/providers 后 GET /api/settings 读回——(a) 非 custom 预设 + baseUrl="https://x" → 读回 x;(b) 非 custom 预设 + baseUrl 空串/缺省 → 读回预设地址;(c) custom 预设 + baseUrl 空串 → 保留旧值;
   - NSIS 产物存在且时间戳为本次。
5. **code-review 子代理**:对 desktop/ 工作区 diff 做双轴审查(Standards:与既有 Rust 代码风格/错误处理一致;Spec:与 Node 契约逐点对齐)。发现真问题→修复→回归步骤 3。
6. **收尾**:更新记忆文件(桌面端已同步、重建完成、关机已执行);输出总结(含根目录游离 svg 遗留物提示);最后执行 `powershell -NoProfile -Command "shutdown /s /t 180"`(引号内整体参数不触发 MSYS 路径转义;取消为同包装的 `shutdown /a`,在总结中注明)。

## 四、明确不做

- **不提交 git**(遵守"只在用户要求时提交"的持久约定;用户未发话)。
- **不改网页端任何文件**(public/、lib/、server.js、test/、README、config.example.json 全部已验收)。唯一例外:无。
- 不动 4763 端口常驻 Node 服务(关机自然停止,重启后用户可再拉起)。
- 不动 config.rs 默认 roots(与 Node 代码默认保持双端一致)。

## 五、风险与预案

- tauri build 编译耗时数分钟:后台运行,超时上限 600s,失败则查环境变量(RUSTUP_HOME/CARGO_HOME)后重试一次。
- rust 模式测试若第 15 项失败:优先怀疑 connectivity.rs 结构映射,对照黑盒响应修 Rust,不改 Node。
- 关机指令有 180s 缓冲,总结消息在其内发出;如需取消用户可 `shutdown /a`(在总结中注明)。
