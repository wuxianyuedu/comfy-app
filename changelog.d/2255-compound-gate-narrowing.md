## Fixed

平台侧「重档静态判据」那一格**逐条按面收窄**了 —— 此前那 13 条判据在平台那一格被
`ifModify` 收窄（面没被本次改动碰到 ⇒ 那一格不执行），在复合档里却**照跑全量**
⇒ 收窄白做（本机实测 22.9s / 复合档逐条墙钟 218746ms 的 10.5%）。

- **面取自收窄登记表**（`scripts/ci-incremental-gates.mjs` 的 `INCREMENTAL_GATES`），
  与平台那一格的 `ifModify` **同一份 glob**（`checkIncrementalGates()` 已在核
  「表 ⇄ `.cnb.yml`」的双向一致）⇒ 两处收窄口径逐字相同，不手抄第二份。
  新增两个出口：`narrowingEntryForScript()`（按**判据脚本**查，不按标签名查）、
  `faceTouched()`（面有没有被碰到，glob→正则**复用** `scripts/vitest-projects.cjs`
  的 `globToRe`，不另写一份 `**` 语义）。
- **收窄的两条边界**：
  - **改动面取不到 ⇒ 一条都不跳**（「不知道」≠「没改」；空清单同样不算「没改」）；
  - **跳过的逐条点名，且不计入「绿」**（跳过不是判过 —— 静默跳过与静默放行是同一族病）。
    合计行因此多一档「按面未触及 N」。
- 连带：`scripts/ci-heavy-gates.mjs` 与 `scripts/ci-incremental-gates.mjs` 的文件头
  那句「**不收窄**」改成「**整格不收窄、格内逐条收窄**」—— 原话约束的是
  「不要给整格挂 `ifModify`」，没覆盖到「格内按面跳过」这个形状。
- 连带：两份守卫用例（`tests/ci-heavy-gates.test.ts` / `tests/changed-scope.test.ts`）
  补登记进**固定结构守护清单** —— 它们此前不在清单里，只在被测脚本改动时才跑，
  而「有人把算法改软」恰好不在改动面上（ISSUE #2227 那一族的同一形态）。
