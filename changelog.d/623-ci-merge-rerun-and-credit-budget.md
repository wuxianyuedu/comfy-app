## Changed

- **每次 PR 合并都会把三十步门禁在 master 上再跑一遍，白烧一半核时**：`push` 与 `pull_request` 通过同一个 YAML 锚点共用整份 `stages`，而平台的事件模型里「点合并」触发的是 `pull_request.merged` 与 master 的 `push` —— 合并动作本身不产生新提交（合并提交按已被门禁验过的源分支 SHA 生成），于是同一份代码被检查了第二遍。现在门禁只挂 `pull_request`，`push` 只留一条形态复核（`check-branch-guard.cjs --merge-commit`：落到 master 的必须是合并提交，非合并提交说明有变更绕过 PR）。
- **全量 vitest 从两遍变一遍**：`pnpm run test` 与 `pnpm run test:coverage` 本来是同一套三千多个用例跑两次，现在合成一步 `pnpm run test:coverage`，覆盖率棘轮照旧（`vitest.config.ts` 的目录阈值），并顺带把 `coverage/lcov.info` 通过平台 `testing:coverage` 插件上报为仓库「洞察」页的曲线。平台侧不设 `lines` / `diffLines` 阈值：那是绝对百分比口径，与本仓库「按目录设门槛」的棘轮是两套数字。
- **新增「工作区对账」步骤**：格式棘轮与格式化分离判定都会就地改写工作区，此前没有任何一步会说明「这批门禁是在什么基础上做的判断」；现在只报「本步开始后被改动的路径」，不把「检出本来就脏」当成失败。
