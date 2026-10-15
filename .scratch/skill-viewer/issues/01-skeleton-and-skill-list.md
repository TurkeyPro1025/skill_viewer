# 01: 项目骨架与技能平铺列表（tracer bullet 起点与测试缝建立）

**What to build:** 全新项目的第一条 tracer bullet。Node 单文件本地服务启动后，伺服一个静态网页和第一个 HTTP JSON API（返回扫描出的已装技能列表）；扫描器读取配置的技能根目录（首票只需支持单一实体根，如 `~/.agents/skills`），解析每个技能文件夹内 SKILL.md 的 frontmatter（name/description）。用户打开网页即看到全部技能的平铺卡片（名称+原文描述）。同时落地项目测试基线：fixture 技能树 + 通过 HTTP API 的黑盒测试——**这是全项目唯一的测试缝，本票建立**。分析结果写入 JSON 缓存索引，再次启动直接读取。Spec 见 `.scratch/skill-viewer/spec.md`。

**Blocked by:** None（可立即开始）

**Status:** ready-for-agent

- [ ] `node` 启动服务后，浏览器打开能看到技能平铺卡片（名称+描述）
- [ ] HTTP API 返回扫描结果 JSON，frontmatter 正确解析出 name/description
- [ ] fixture 技能树（正常技能、缺 SKILL.md 的文件夹、嵌套子目录）+ API 黑盒测试一键可跑，无需任何真实 API key
- [ ] 分析结果持久化为 JSON，二次启动不重新扫描也能显示
- [ ] 扫描根路径来自配置文件，无硬编码绝对路径
