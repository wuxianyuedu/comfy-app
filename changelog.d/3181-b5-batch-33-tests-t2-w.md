## Changed

- **oxlint B5 清账子批33**（ISSUE #3181 的总账批次之一）：`tests/t~w` 段的 11 份文件
  （theme-token-single-source、trpc-surface-executors、tsc-diagnostic-executors、
  turbopack-tracing-excludes、tw4-canonical-ratchet、type-assertion-gate、
  workflow-disk-sync-single-writer、workshop-input-schema-derivation、
  oxlint-policy-rules、ship-exec、ship）从 `typescript/no-unsafe-type-assertion`
  的文件级豁免里摘除，23 处存量就地修掉（`JSON.parse` / CJS 模块 / trpc `_def`
  改形状守卫；catch 改字段读取；成员判断改 `some` 等值；探针配置的规则条目
  **整条保留**——只留 message 会被 oxlint 的 options 校验拒掉；四处「故意喂错型 /
  故意不满型」的用例改为**行级豁免 + 理由**）。判决面
  `oxlint.parity.config.mjs` 同批删行；台账
  `docs/audits/2026-11-04-oxlint-t1-burndown.md` 11 行改「已清」，B5 累计更新为
  子批1–33：592 份 / 1473 处已清（余 16 份 / 23 处）。
  `pnpm run lint` 0 诊断、`tsc --noEmit` 绿、11 份用例绿。

  Refs #3181
