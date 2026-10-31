## Changed

oxlint `eslint/no-negated-condition` 全仓清零（#2775）：150 处 / 90 份，`if (!x) {A} else {B}` 与 `!x ? A : B` 一律改成正条件 + 两臂互换（if 的两个分支、三元的两臂）。

手改 4 处 fixer 不动的位置，都是「换臂要搬一整块」的形态：`NodePreviewCard` 的 `data ? !expanded ? 概要 : 面板`（内层两臂互换）、`WorkflowNode` 的 `emptyHint`（`modelFilter !== "all"` → `=== "all"`）、`check-tsc-diagnostic-executors.cjs` 与 `check-allow-builds.cjs` 的 `if (!…) { 报错 } else { 大块 }`（改成 `if (…) { 大块 } else { 报错 }`）。

语义核对：fixer 产物的 139 个 hunk 逐对看 —— 每条新增的 `=== undefined|null|""|0|false` 在同一 hunk 里都有对应的 `!==` 原文（0 处缺对）；`&&` / `||` 互换 0 处；`else if` 链上的互换读下来等价。三元只换臂、条件取反，求值顺序不变。

整条规则至此全仓 0 命中（2405 份扫描）。`tsc --noEmit`、eslint 通过；受影响用例闭包 446 份（固定 97 + 受影响 349）本地跑过一遍：348 份绿，`tests/shell-gate.test.ts` 一条 30s 超时（git 夹具，满载形态），隔离复跑 52 条全绿 —— 按 §13.6.4 记为负载假红，不动判据。
