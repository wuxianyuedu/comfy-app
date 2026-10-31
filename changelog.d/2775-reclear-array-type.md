## Changed

- oxlint `typescript/array-type` 补齐全仓面（#2892）：33 处 / 8 份。
  上一轮「全仓清零」只覆盖 `src/**`，本次残留全部在 `tests/**`：按预设选项
  `{ default: "generic" }`（`T[]` → `Array<T>`）改写类型注解，运行期形态不变。
  纯类型面改写，不涉及任何断言逻辑与运行时取值。
