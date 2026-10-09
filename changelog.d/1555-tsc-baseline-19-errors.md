## Fixed

- **收掉 `master` 基线上 19 条 `tsc --noEmit` 报错（硬规则 7 / §13.6.2）**：这类红在 #623 之后没有任何 CI 兜底，且平台侧是 squash 合并、不跑本地钩子，会一路传染给从它分出的每一个分支的提交 —— 谁碰谁被拦，而错的原文件自己没碰过。按 §13.6.2 在干净基线（`git worktree` + `origin/master`）上复算，确认 19 条逐字一致、均为既有红，非某次改动引入。
- 三个根因，全部落在**声明落后于代码**这一类（行为一行未改）：
  - `scripts/visual-baselines.mjs`（8 条）：`FRESHNESS_TRACKS` 长出 `daily` / `skipHow`、`freshnessRecord` 接上 `skippedReason`、`checkFreshnessLedger` 接上 `now` 之后，三处 JSDoc（`freshnessTrack` 的 `@returns`、`freshnessRecord` 的 `@param` / `@returns`、`checkFreshnessLedger` 的 `scope` 形状）还停在旧形状，且 `record` 的 `@type` 写成 `Record<string, string>` 与返回类型对不上。按 §12.18 顺带把 `freshnessRecord` 与 `parseSkip` 的声明收宽到实测形状。
  - `scripts/visual-freshness-gate.mjs`（4 条）：上一条的**下游**，`track.daily` / `track.skipHow` / `now` 的位置本来就是对的，报错随 `freshnessTrack` 与 `checkFreshnessLedger` 的声明修正一并消失。
  - `scripts/shell-gate.mjs`（4 条）：`findCargo()` 里 `process.env.CARGO_HOME && path.join(...)` 得到 `string | undefined`，而后续那个 `.filter` **构不成类型收窄**（TS 不会据此把数组收成 `string[]`）。改成 `CARGO_HOME ? ... : ""` 占位 + 统一滤空，并在变量上标 `@type {string[]}`；运行时取舍与原先完全等价。
- 同批修掉一条**同根因的既有测试红**（`tests/e2e-run.test.ts`，「四个值各就各位」）：它比对 `freshnessTrack("e2e")` 的期望对象仍是四栏，`daily` / `skipHow` 加上之后一直没跟上。已在干净基线上确认这条红同样既有。
- 其余 3 条在 `tests/e2e-run.test.ts`（`skippedReason` / `now` 入参），随上面的声明修正消失；`parseSkip` 的 `@param` 由 `string[]` 收宽为 `unknown[]`，因为「`--skip` 后面什么都没给」时那一格读出来就是 `undefined`，正是该判据要覆盖的形状。
- 回归：`pnpm exec tsc --noEmit` 19 → 0；`tests/shell-gate.test.ts` / `tests/e2e-run.test.ts` / `tests/visual-baselines.test.ts` 共 62 条全绿；结构 / 函数长度 / 重复 / 注释语言 / 文档引用 / 判据执行者等门禁全绿。
