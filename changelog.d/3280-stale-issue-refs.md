## Fixed

- **11 章「谁在跟」那两个单号改成口径本身**：`docs/standards/11-测试与可观测性.md` 覆盖率棘轮段写「受影响用例那一格已随 #3052 撤到每日全量（#3010 / #2739 两单管它的预算与恢复）」，而 #2739（2026-11-05）、#3010（2026-11-06）现均为 `closed/completed`。读者顺着号走会以为「预算与恢复」还有人在跟；文档不参与任何判据，这种漂移不会自己冒红。
- 改成不绑号码的现在时口径：受影响用例 / 固定结构用例两格在 CNB 的 PR 档已撤到每日全量，PR 侧执行者在 GA `pr-gate.yml` 的并行 job 上；内部 25 分钟墙钟预算仍生效 —— 缺省取 `scripts/affected-launch-wallclock.mjs` 的 `STAGE_WALL_CLOCK_MS`，`COMFY_AFFECTED_WALL_CLOCK_MS` 没在 workflows 里设（`resolveWallClockMs(undefined)` 回缺省值）；大改动面再撞预算时按当次读数重开单。
- `docs/generated/11-测试与可观测性.md` 由 `pnpm run doc:render -- --only docs/standards/11-测试与可观测性.md` 同批重生成（只写这一份，不跑无参全量档），镜像与源逐字对齐。本单只管这一处叙述，不碰任何判据。
