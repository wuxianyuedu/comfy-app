## Changed

- **oxlint B5 清账子批31**（ISSUE #3181 的总账批次之一）：`tests/t` 段的 9 份文件
  （tauri-tools-cache + 七个 test-\* 门槛自测）从 `typescript/no-unsafe-type-assertion`
  的文件级豁免里摘除，23 处存量就地修掉（catch 失败形状改字段读取；CJS 判据模块改
  **形状谓词**收窄后解构；`JSON.parse` 改 `isRecord` / 局部守卫；drizzle 表名与
  sqlite-proxy 宿主改符号键 + 守卫读取；vitest 解析配置按 unknown 读、字段形状
  现场答）。判决面 `oxlint.parity.config.mjs` 同批删行；台账
  `docs/audits/2026-11-04-oxlint-t1-burndown.md` 9 行改「已清」，B5 累计更新为
  子批1–31：568 份 / 1435 处已清（余 40 份 / 61 处）。
  `pnpm run lint` 0 诊断、`tsc --noEmit` 绿、9 份用例绿。

  Refs #3181
