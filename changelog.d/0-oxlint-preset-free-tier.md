## Changed

按 `oxlint-config-awesomeness@4.7.1` 的启用面（读 `node_modules` 里的 dist 与 rules，不读 README），
把全仓 0 命中的 171 条原生规则并入成交通判决面：`oxlint.parity.config.mjs` 规则数 **208 → 379**
（另有 2 条 jsPlugin），`0 诊断`，全仓 57.1s（基线 56–57s，增量 <1s）。

- **预设口径**：categories 开 correctness / suspicious / perf / pedantic / style 五档；
  restriction / nursery 默认 off，仅收预设显式抬成 error 的条目。
- **选入条件**：`--type-aware` 全仓真跑 2453 份文件 0 命中；插件已在 `plugins` 注册
  （jest / vitest / jsdoc / vue / react_perf / node / promise 未开，本批不碰，避免「配置写着、
  实际不注册」的假绿）。
- **剔除**：与已有 `typescript/*` 同义的 5 条（`no-array-constructor` / `no-implied-eval` /
  `no-unused-expressions` / `no-throw-literal` / `prefer-promise-reject-errors`，避免双报）；
  预设没给选项会空转的 `eslint/id-denylist` / `id-match`。
- **未纳入（缓档）**：有命中的 128 条，例如 `prefer-named-capture-group` 625、
  `strict-void-return` 955、`no-unsafe-type-assertion` 1425、`require-await` 744、
  `max-nested-calls` 713、`no-use-before-define` 550 —— 都要业务改动或大批量改写，
  清单与样本留在本轮审计表待拍口径。

验证：`pnpm run lint` 0 诊断 / 379 rules / 57.1s；`tsc --noEmit`、相关 vitest、
`pnpm run check:premerge` 全绿。
