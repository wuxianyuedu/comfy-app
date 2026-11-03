## Changed

**`awesomeness/no-novel-comments` scripts 片处置（#2924 第一步）**：
`scripts/**` 实测 **2536 处 / 323 份 → 0 处**，走**目录级例外**而不是逐行禁用。

- 依据是抽样：锁定基线快照 `01d92025c`，按目录分层抽 114 处逐条判读 ——
  复述型 **0 条（0%）**、why/约束 28.1%、JSDoc 类型 57.0%、模块头 14.9%。
  门禁与取证脚本的长注释主体是判据出处、阈值实测、平台/子进程的真实现场。
- 配置变更：`oxlint.config.ts` 的 `overrides` 新增一条 —— `files: ["scripts/**"]` 下
  把 `awesomeness/no-novel-comments` 置 `off`，注释里写明抽样证据与复审条件。
- 例外是**示例证据，不是永久豁免**：新增脚本仍按口径写注释（不复述代码行为），
  评审发现复述型即删；复述型占比回升到 30% 以上时撤掉这条 override。
- 删除 1 处真复述：`scripts/ci-toolchain-python.mjs` 的 `listDirectories` JSDoc 里
  一句与相邻行逐字重复的话；其余长注释原样保留。
- 未触碰移交包目录（`src/components/**`、`src/app/**`、`tests/**`、`src/server/**`、`e2e/**`）。
