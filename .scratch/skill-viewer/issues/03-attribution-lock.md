# 03: 归属引擎·lock 主表（仓库→子技能结构成型）

**What to build:** 独立的归属引擎模块：读取 skills CLI 的安装清单 `.skill-lock.json`，按技能文件夹名 join，产出"仓库→子技能"两级结构；lock 中记录的仓库内路径分组（如 mattpocock 仓库的 engineering/misc/productivity/in-progress）作为分类参考进入缓存。首页从平铺列表升级为按仓库分组展示，lock 未覆盖的技能暂入"未归属"平铺区。引擎接口设计为可注册的清单格式识别器（本项目的开源卖点，结构上先立起来）。真实环境验收：ui-ux 7 件套与 mattpocock 38 件套零手动操作归位。

**Blocked by:** 01（骨架与技能平铺列表）

**Status:** ready-for-agent

- [ ] fixture 中有 lock 条目的技能按"仓库→子技能"两级结构展示
- [ ] 真实环境运行时 ui-ux-pro-max 7 技能、mattpocock 38 技能自动归位
- [ ] lock 提供的仓库内分组作为分类参考写入缓存
- [ ] 无 lock 条目的技能进入"未归属"区，功能不降级
- [ ] 引擎以注册表方式接入识别器，新增一种清单格式不需要改核心
