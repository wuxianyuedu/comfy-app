## Changed

- **oxlint B5 清账子批30**（ISSUE #3181 的总账批次之一）：`tests/s` 段的 12 份文件
  从 `typescript/no-unsafe-type-assertion` 的文件级豁免里摘除，23 处存量就地修掉
  （catch 的失败形状改字段读取 + `asText` 收正文；`JSON.parse` 的返回值改
  `isRecord` / 局部形状守卫收窄；动态 import 改**字面量说明符**让 TS 沿 import 图
  拿推断类型；`matchMedia` 桩按平台 API 写全成员后直赋；定时器桩改 `defineProperty`）。
  判决面 `oxlint.parity.config.mjs` 同批删行；台账
  `docs/audits/2026-11-04-oxlint-t1-burndown.md` 12 行改「已清」，B5 累计更新为
  子批1–30：559 份 / 1412 处已清（余 49 份 / 84 处）。
  `pnpm run lint` 0 诊断、`tsc --noEmit` 绿、12 份用例 156 条绿。

  Refs #3181
