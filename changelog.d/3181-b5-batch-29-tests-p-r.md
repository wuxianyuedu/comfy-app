## Changed

- **oxlint B5 清账子批29**（ISSUE #3181 的总账批次之一）：`tests/p~r` 段的 12 份文件
  从 `typescript/no-unsafe-type-assertion` 的文件级豁免里摘除，24 处存量就地修掉
  （catch 的失败形状改字段读取；`JSON.parse` 的返回值改运行时形状守卫；共享的
  unknown 收窄改用 `~/lib/is-record` 的 `isRecord` / `isUnknownArray`）。判决面
  `oxlint.parity.config.mjs` 同批删行；台账 `docs/audits/2026-11-04-oxlint-t1-burndown.md`
  12 行改「已清」，B5 累计更新为 子批1–29：547 份 / 1389 处已清（余 61 份 / 107 处）。
  `pnpm run lint` 0 诊断、`tsc --noEmit` 绿、12 份用例绿。

  Refs #3181
