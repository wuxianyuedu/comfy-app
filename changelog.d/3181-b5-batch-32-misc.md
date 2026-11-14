## Changed

- **oxlint B5 清账子批32**（ISSUE #3181 的总账批次之一）：杂项段 13 份文件
  （dialog-backdrop-contrast、dist-artifact-hygiene、hook-affected-launch、
  jsdom-capability-gate、lib-layer-boundaries、lib-node-only-declarations、
  linux-env-bootstrap、lockfile-diff、log-run-layout、merge-changelog-anchor、
  no-platform-ci-config、node-engines、on-demand-duties-gate）从
  `typescript/no-unsafe-type-assertion` 的文件级豁免里摘除，19 处存量就地修掉
  （`JSON.parse` / CJS 模块改形状守卫；catch 改字段读取；三元组改逐分量构造；
  成员判断改 `some` 等值；两处「故意喂错型」的用例改为**行级豁免 + 理由**）。
  判决面 `oxlint.parity.config.mjs` 同批删行；台账
  `docs/audits/2026-11-04-oxlint-t1-burndown.md` 13 行改「已清」，B5 累计更新为
  子批1–32：581 份 / 1454 处已清（余 27 份 / 42 处）。
  `pnpm run lint` 0 诊断、`tsc --noEmit` 绿、13 份用例绿。

  Refs #3181
