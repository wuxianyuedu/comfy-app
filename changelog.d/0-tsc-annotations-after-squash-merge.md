## Fixed

`master` 基线带着 25 条 `tsc --noEmit` 错（**不是本批引入的**）—— `01d761ae`
（PR #1553「每天首次自证扩到三档」）在**无 `node_modules` 的环境**里做合并，
提交信息末尾自己写着「走不到 tsc / eslint / vitest」，于是给 `FRESHNESS_TRACKS`
补了 `daily` / `skipHow` / `dirty` / `dirtyHow` / `graceMs`、给
`checkFreshnessLedger` 的 `scope` 补了 `dirtySince`、给 `parseLedgerFlag` 收了
`unknown[]`，而**同批没有更新 JSDoc 的 `@type`**（`checkJs` 下这几处注解就是
类型的事实来源）。PR 在平台侧是 squash 合并、不跑本地钩子，谁都没看见。

按规范 §13.6.2 在干净基线上复算（`git worktree add ../.wt-base-check origin/master`
→ 同一条 `tsc --noEmit`）：25 条**逐条相同**，确证是别线的红。A 组是**硬闸**
（须为 0、没有「带病通行」的中间态），落进 `master` 就拦住从它分出的**每一个**提交
—— 所以就地收掉，单独一条提交、单独一份碎片。

修法逐条（补注解成事实的样子，不是「让报错消失」）：

- `visual-baselines.mjs`：`freshnessTrack()` 的 `@returns` 补 `dirty` /
  `dirtyHow` / `graceMs`（**这是根** —— 三栏都从它流出来）；
  `checkFreshnessLedger()` 的 `scope` 补 `dirtySince?` 与 `track` 那三栏；
  两栏豁免的循环数组收 `as const`（否则 `field` 推成 `string`，索引 `record` 报 TS2538）。
- `visual-freshness-gate.mjs`：`dirtySinceToday()` 的 `earliest` / `stamp`
  显式标类型 —— 它们在闭包 `flush()` 里被赋值，TS 的控制流分析看不进去，
  不标就被收窄成初值 `null`。
- `artifact-run.mjs` / `full-suite-run.mjs`：`--skip` / `--dirty` 的循环数组收
  `as const`，让 `flag` 保持字面量联合以匹配 `parseLedgerFlag` 的形参。
- `tests/daily-tracks.test.ts`：补 `node:path` 的具名 `join` 导入（5 处裸用、
  此前只有 `path.join`）；`sinceFor` 的返回处显式断言 —— 同一条闭包赋值链；
  那条「记账走同一份内核」的文本断言从 `writeFreshness` 改钉现役内核符号
  `writeSkipRecord`（断言意图不变）。
- `scripts/daily-run.mjs`：删掉真·无用的 `writeFreshness` 导入（TS6133）。

节点校验：`pnpm exec tsc --noEmit` → **0 行**（改动前 25 条）；
`pnpm exec eslint <改动文件>` → 零警告；相关 5 份用例 78 条全绿。
