## Changed

oxlint `typescript/prefer-optional-chain` 清零第二批（#2775）：`src/**` 4 份 + 脚本档 1 处漂移。

第一批（PR #2993 / `10e368952`）落的是 `scripts/**` 39 份。这一批是拆出去的另一半 ——
`sidebar.tsx` / `layout-budget.ts` 的 `choice !== null && choice.atCrossing === crossings`
→ `choice?.atCrossing === crossings`、`llm/server.test.ts` 的条目过滤、
`run-engine.ts` 的 `human !== null && human.rev === rev` → `human?.rev === rev`：
都是「有值才取」的同一件事，`!== null` 那半句与 `&&` 本来就等价。

拆批的原因是第一轮 CI 的现场：`src/server/agent/run-engine.ts` 那 1 行在反向 import 闭包里
带出 99 份用例，44 份改动一起交时「受影响用例」格是 155 份、26 分钟墙钟到头被掐断，
按「未判定」退 2（build `cnb-pl9-1k6b45aqm` / stage-9）。

`src/**` 4 份按 oxfmt 收口；`scripts/**` 不在格式判据面（`check-format.cjs` 只判 `src/**`
+ `.storybook/**`）。

回归：`tsc --noEmit` 0 错、相关用例（layout-budget / llm-server / premerge-push-trigger）72 条全绿。
