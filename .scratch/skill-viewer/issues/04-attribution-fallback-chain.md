# 04: 归属补充链与未知来源分组

**What to build:** 归属瀑布补全：带 `.git` 的技能读远端地址归属（如手动 clone 的 travel-skill）；frontmatter 带来源 URL 的技能归属并明确标注"创作上游"（区别于安装来源——同一技能两者可能不同）；仍无法归属的进入明确的"未知来源"分组。来源归组与分类标签保持两套独立数据。

**Blocked by:** 03（归属引擎·lock 主表）

**Status:** ready-for-agent

- [ ] fixture 中带 `.git`（含 remote）的技能被归属到对应仓库
- [ ] frontmatter URL 归属显示"创作上游"标注，不与安装来源混淆
- [ ] 无法归属的技能进入"未知来源"分组，浏览与阅读功能不受影响
- [ ] 黑盒测试覆盖瀑布各层的优先级顺序（lock > .git > frontmatter > 未知）
