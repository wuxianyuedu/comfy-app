## Added

- **`tsconfig.json` 打开 `noFallthroughCasesInSwitch`**：`strict: true` 里
  **不含**这条，导致 `switch` 少写 `break` 会**静默 fallthrough** — 前后两个
  case 都合法但只有前一个是意图，`tsc` 与 eslint 都不报。项目里 17 处 `switch`
  全数命中 `tsc --noEmit` 通过（空 case 允许 fallthrough，
  `case "TI2I": case "R2I": return ...` 这类同分支复用不触发；带语句却漏 break
  的情况**零处**），说明存量代码本就干净，这条判据是防**未来**「新加 case 忘
  break」的成本为零的一道锁。
  同段 `noImplicitOverride` 与 `exactOptionalPropertyTypes` 暂不开：前者是「类
  继承纪律」（项目里 class 少、`DrizzleRepository` 一类才碰得到，独立议题）、
  后者牵动所有 `{ field?: T }` 的赋值语义（全库扫下来预期至少几十处改动，收益
  与噪声不成比例），各自单独立项。类型安全审查 src/lib 报告的 H-1 条目。
