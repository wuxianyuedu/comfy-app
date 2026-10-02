## Changed

- 组件工作台的**组件覆盖率**从「写在 `docs/guide-storybook.md` 里的一句话」升成机器判据：
  现算「`ui/` 下有多少组件被 `.stories.tsx` import 到」，与
  `scripts/.storybook-coverage-baseline.json` 比，**只许升不许降**；新增组件时
  分母变化会要求同批回答「它为什么没有 story」（补一份，或写进
  `scripts/storybook-checks/coverage-ledger.mjs` 的逐条理由表）。判据与门禁共用同一份
  纯函数台账，接进 `tests/storybook-component-coverage.test.ts`、
  `scripts/storybook-check.mjs` 与 pre-commit D 组。

## Added

- `ui/` 下新增 18 份 story（覆盖组件从 3 个增至 21 个）：`alert` / `aspect-ratio` /
  `avatar` / `kbd` / `list-badge` / `page-loading` / `progress-bar` / `skeleton` /
  `source-tag` / `spinner` / `status-badge` / `status-dot` / `task-type-chip` /
  `toggle` / `validation-error-list` / `water-fill-progress` /
  `simple-key-handler`。全部零数据依赖（纯 props / Args 可注入），
  逐 story 在真实浏览器里核过渲染与 console。

## Fixed

- `README.md` 的「双击入口」对照表：Storybook 那格还写着「（开发者命令，无双击入口）」，
  而入口早已存在（`tools/start/storybook.ps1`，§9.5 与 `tools/start/README.md` 都登记了）
  —— 改成实际路径。

## Documentation

- 规范 16 新增 §16.2.3.5「组件覆盖率是棘轮判据，不是文档里的一句话」；
  11 §11.8 与 `docs/guide-storybook.md` 各补一段接线说明；
  `PRODUCTION-GAPS` 的 F6 随之更新（只剩「像素基线」那一格）。
