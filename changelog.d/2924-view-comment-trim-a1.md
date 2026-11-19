## Changed

- **视图层注释缩编：`no-novel-comments` 在 `src/components/**` + `src/app/**` 清零（1662 处 / 835 份）**：
  按「甲案」把超过 5 行的注释块压到 ≤5 行 —— 保留不显然的约束/事实（为什么必须这样、否则会怎样、
  契约/兼容/平台行为）与坐标（ISSUE 号、回归记录、出处），删掉纯叙事与复述代码行为的句子；
  `SAFETY:` 断言、`oxlint-disable` / `eslint-disable` 指令及其理由原样未动，未新增任何禁用、未改
  任何代码 token（835 份逐份做 TypeScript 词法 token 流比对，全部逐项相同）。
  验收：`oxlint src/components src/app` 该规则 0 条、`tsc --noEmit` 绿、`vitest run src/components
  src/app` 282 份 / 2730 条全绿。
