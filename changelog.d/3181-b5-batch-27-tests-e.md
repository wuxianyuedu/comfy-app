## Changed

- **oxlint B5 清账子批27**（ISSUE #3181 的总账批次之一）：`tests/e~executor` 段的 8 份
  文件从 `typescript/no-unsafe-type-assertion` 的文件级豁免里摘除，33 处存量就地修掉
  （mock 入参标类型后走类型化 `mock.calls`；`JSON.parse` / 动态 `import` 的返回值改
  运行时形状守卫；共享的收窄改用 `~/lib/is-record` 的 `isRecord` / `isUnknownArray`，
  不再各写一份）。判决面 `oxlint.parity.config.mjs` 同批删行；台账
  `docs/audits/2026-11-04-oxlint-t1-burndown.md` 8 行改「已清」，B5 累计更新为
  子批1–27：522 份 / 1343 处已清（余 86 份 / 153 处）。
  `pnpm run lint` 0 诊断、`tsc --noEmit` 绿、8 份用例绿。

  Refs #3181
