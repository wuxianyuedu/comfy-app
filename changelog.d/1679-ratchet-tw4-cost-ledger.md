## Fixed

- tw4 两格的引擎成本**量清了并写进规范**（ISSUE #1679）：`tests/ratchet-update-guards.test.ts`
  里那 14.3s 是 4 × 1.85s 的**不可摊平**冷启（`import` + `loadDesignSystem` 只要 17ms，
  全量类名表在**第一次** `canonicalizeCandidates` 才建）。§13.5.8.1 那句「正确方向是让
  两格共用一次引擎启动」是没量时的方向，现按实测改成「不存在」，并把三个被否决的方向
  （形状收窄 / 批量 / 预热）连同读数留在那儿，避免下一个人再走一遍。

- `--full` 与「全量那一档」的边界落成判据：`--full` 跑的是 `vitest run`（**不带**
  `--coverage`），而覆盖率门槛只在 `pnpm run test:coverage`（`full-suite-run.mjs` 记账）
  那一档判 —— 所以 `--full` 不许去写 `scripts/.full-suite-freshness.json`。判据两侧
  一起判（入口不记账 + 记账通道挂在 `test:coverage` 上），变异测试确认它会红。
