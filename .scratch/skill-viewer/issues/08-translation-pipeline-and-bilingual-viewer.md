# 08: 翻译管线与块级对照阅读

**What to build:** 端到端翻译体验：Markdown 解析为内容块（标题/段落/列表/引用/代码块）并分配稳定块 ID；YAML frontmatter 与代码块占位摘出、译后回填（代码、命令、URL、路径、环境变量一律不译）；按块分批调用 UApiPro AI 翻译接口（`POST /api/v1/ai/translate`，`target_lang=zh, style=professional, context=technical, preserve_format=true`；单次 1 万字符内、4 QPS 节流）；译文块与原文块按 ID 关联，查看器左右分栏块级对照、滚动联动。入口 SKILL.md 在分析阶段批量预翻。首次翻译前明确提示用户：文档内容将上传外部 API。API key 从环境变量或系统凭据存储读取，绝不落明文。测试全程用 stub provider。

**Blocked by:** 07（文档查看器·原文阅读）

**Status:** ready-for-agent

- [ ] 英文技能点开后左右分栏、内容块一一对应、滚动联动
- [ ] 代码块/命令/URL/路径/frontmatter 保持原文未被改写（stub 断言 + 真实抽查）
- [ ] 超过单次字符上限的文档自动分块，语义单元（段落/列表项）不跨块撕裂
- [ ] 4 QPS 节流生效，积分消耗对用户可见
- [ ] 首次翻译出现隐私提示，用户确认后才发起外部请求
- [ ] API key 不出现在任何明文文件；黑盒测试经 stub 全链路可跑
