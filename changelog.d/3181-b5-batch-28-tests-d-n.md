## Changed

- **oxlint B5 清账子批28**（ISSUE #3181 的总账批次之一）：`tests/d~n` 段的 13 份文件
  从 `typescript/no-unsafe-type-assertion` 的文件级豁免里摘除，22 处存量就地修掉
  （`JSON.parse` / CJS `require` / 动态 `import` 的返回值改运行时形状守卫，catch 的
  失败形状改字段读取；共享的 unknown 收窄改用 `~/lib/is-record` 的 `isRecord` /
  `isUnknownArray`）。判决面 `oxlint.parity.config.mjs` 同批删行；台账
  `docs/audits/2026-11-04-oxlint-t1-burndown.md` 13 行改「已清」，B5 累计更新为
  子批1–28：535 份 / 1365 处已清（余 73 份 / 131 处）。
  `pnpm run lint` 0 诊断、`tsc --noEmit` 绿、13 份用例绿。

  Refs #3181
