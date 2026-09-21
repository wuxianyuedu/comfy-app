## Added

- **补 project Skill 作 MCP 工作流 owner（消 `mcp-without-workflow-owner` 告警）**：Better Harness 第二轮评审 F4——两个本地只读 MCP（codegraph / zvec-grep）此前只有 AGENTS.md 的散文路由，agent-customize 的 detector 要的是**结构化 Skill/Command owner**，故告警仍在。新增 `.qoder/skills/code-navigation/SKILL.md`：说明何时用（先看 `scripts/check-*.cjs` 门禁 → 再按需 codegraph 语义图谱 / zvec-grep 正则检索）、输入输出（参数以各 server `--help` 与 `.mcp.json` 为准；索引是本地缓存、删除对源码零影响）、以及校验/审批边界（只读、不作提交前独立校验源、改代码仍走分支+PR+pre-commit）。重跑 agent-customize lint，`mcp-without-workflow-owner` 已消解。
- **`.gitignore` 相应放行**：原来把整个 `.qoder/` 忽略（且重复两行），会让可提交的 project agent 资产 skills/commands 也进不了库。改为 `.qoder/*` 忽略内容（Better Harness run 产物、IDE 会话/索引等本地产物照旧不入库），但 `!.qoder/skills/` / `!.qoder/commands/` 放行共享配置（等同 AGENTS.md，应入库）。顺带去掉重复的 `.qoder/` 行。
