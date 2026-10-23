## Changed

- **跨平台门禁名集合对齐**：`scripts/quality-gate.mjs` 的 `GATES` 含 `dailyAttendance`
  （#2114 加的按需档），但 `scripts/quality-gate.ps1` 的 `$Blocks` 漏了这一项，两侧门禁名
  集合因此不等（9 vs 10）。`tests/ps1-consistency.test.ts` 的「两侧的门禁名集合一致」正是
  为防这种「只改一侧」而存在，于是任意触碰 `tools/**/*.ps1` 的 PR 都会撞上它（本单的
  run-local 改动即其一）。
  本次在 `.ps1` 侧补上 `dailyAttendance`（`Run=$false`，与 `.mjs` 的 `run:false` 对齐），
  同步 `ValidateSet` 与用法串；`.mjs` 侧不动（它本就完整）。

  （无关联 issue；属门禁一致性回归，顺手修以放行走本单的 run-local 改动）
