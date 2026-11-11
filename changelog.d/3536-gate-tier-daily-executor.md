## Fixed

- 修复 `tests/commit-gate-tier.test.ts` 的主干基线红（#3536）：「受影响用例 / 固定结构
  用例 / 覆盖率上报 从 PR 撤出」一条仍断言 `.cnb.yml` 里有 `- name: 覆盖率上报` stage，
  而该执行者已随 #3504 整体迁到 GA（`.github/workflows/daily.yml` 的产物出口 step）。
  判据改为沿用 `ci-ga-trigger-map.mjs` 的 `DAILY_GATE_EXECUTORS` 登记对位 daily.yml
  step（与 `ci-incremental-gates.test.ts` 的「每日 API 文档」一条同一模式），并钉住
  产物出口的执行语义（upload-artifact + `if: always()` + `if-no-files-found: warn`）。
