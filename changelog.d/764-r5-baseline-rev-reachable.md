## Fixed

- **R5 文件行数棘轮的基线修订号在 `master` 上不可达，`--strict` 对 `master` 恒红**：`scripts/.file-size-baseline.json` 的 `baselineRev` 记的是合并提交里带进来的那一个副本（`ee203285`，`ruleVersion` 仍是 3、且写的是 `src/components/studio/shared/workflow-io.ts` 这类迁移前的旧路径），它不属于 `master` 的历史，任何 ref 都不再指向它。于是「按 `baselineRev` 同口径重数」（ISSUE #653）一律失败，判据退回「拿记录值直接比」，把三个**谁都没碰**的文件读成「继续变大」（`log-store.ts → 1550 → 1557`、`workflow-io.ts → 994 → 1025`、`workflow-param-mapping.ts → 1049 → 1093`）。
- 修法：`baselineRev` 改记 `master` 合并前那个可达的提交，取值按 `master` 现状重记（`1557` / `1025` / `1093`）—— 棘轮从「对不上的两个格式时代相减」回到「同一个修订号上的实测值」。收紧后 `--strict` 转绿，且棘轮判据仍然有效（给这三个文件任意一个再加两行即被阻断）。
