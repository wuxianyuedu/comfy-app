## Added

- **新增 `tests/helpers/source-shape.ts` 的 `normalizeControlFlow(src, fileName?)`**：基于 `typescript` 解析器，把单语句控制流块（`if`/`else`、`for`、`for-of`、`for-in`、`while`、`do`）折成单行体 `if (cond) stmt;` ⇄ `if (cond) { stmt; }` 幂等互换。只折**块括号**、绝不碰**对象字面量括号**（`if (a) return { x: 1 }` 不会被误折），多语句块与非 JS 家族源码（`.rs`、`.ps1`）原样返回。

- **配套测试**：`tests/source-shape.test.ts`（正反例单测：嵌套收敛、幂等、对象字面量不折、非 JS 原样返回）；`tests/source-shape-single-source.test.ts`（单源守卫，禁止本地再抄一份，§12.18 复用优先）。

- **用途**：这是 oxlint `curly` 机械批（以及任何给单语句体加 `{}` 的规则）的**前置地基**——契约测试读源码做 `toContain`/`toMatch` 形态断言时，先过一遍归一化再比对即对加括号免疫。把 `normalizeControlFlow` 接到具体契约测试的读源处是下一锹（见对应 issue）。
