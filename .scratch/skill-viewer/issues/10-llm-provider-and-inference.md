# 10: LLM provider 与归属推断

**What to build:** OpenAI 兼容的 LLM provider 适配器（可配置 base URL + key + model，目标 DeepSeek 或 GLM，key 走环境变量/凭据存储）。两条消费链路：① 独立技能的中文概述按统一格式生成（用途/适用场景/主要能力/使用方式/相关分类）；② 无归属记录的技能由 LLM 读 SKILL.md 正文推断候选仓库，结果标注"推断"。provider 未配置时系统优雅降级（沿用 05 票的占位逻辑），不报错不阻塞。UApiPro 翻译接口不得充当摘要模型。

**Blocked by:** 04（归属补充链与未知来源分组）、05（概述种子与分类体系）

**Status:** ready-for-agent

- [ ] 配置 DeepSeek/GLM 后，独立技能概述自动生成并缓存（统一格式）
- [ ] 无归属记录的技能显示 LLM 推断的候选仓库，带"推断"标记
- [ ] 未配置 LLM 时全部功能可用，仅概述降级为占位
- [ ] stub LLM 下黑盒测试覆盖概述与推断两条链路
