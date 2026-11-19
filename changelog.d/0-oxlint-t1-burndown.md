## Changed

- **oxlint 判决面开 5 条 T1 语义规则，存量按文件挂账、分批次清**（判决面
  `oxlint.parity.config.mjs`，规则数 379 → **384**）：
  `no-await-in-loop`、`no-use-before-define`（`{ functions: false }`，只判 TDZ）、
  `eslint/prefer-named-capture-group`、`typescript/require-await`、
  `typescript/no-unsafe-type-assertion`。
  存量 3722 处 / 1298 份文件用**逐字路径**的 override 块豁免（不是 glob，新增文件
  不自动继承）；每行注明「存量 N 处 · 清账目标 Bn · 新代码不禁用」。
  `lint` 仍 0 诊断（384 条规则，约 55s），耗时增量 ≈ 1–2s。
- **六条 T1 里的 `typescript/strict-void-return` 不开**：981 处里 546 处（56%）是
  TS 合法的「返回值函数传给 void 回调」形态，规则只有 `allowReturnAny` 一个选项，
  收不干净；证据留在台账里，等口径。
- 新增清账台账 `docs/audits/2026-11-04-oxlint-t1-burndown.md`：规则 × 文件 × 处数 × 批次 × 状态，
  含 T2 结构规模类（只审计）与 vitest 插件的试跑结论。
- 评估尺 `oxlint.config.ts` 同步开同一组规则（**不挂账**，保留全量读数语义）。
