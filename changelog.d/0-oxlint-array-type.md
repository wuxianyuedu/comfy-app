## Changed

- **oxlint 迁移·机械批 1：`typescript/array-type` 切泛型形**——`T[]` → `Array<T>`（含 `readonly T[]` → `readonly Array<T>`），与预设 `oxlint-config-awesomeness` 同款选项（`default: "generic"`）。3648 处 `oxlint --fix` 全自动收敛 + 1 处 fixer 不吃的嵌套形态手补（`executor-cli.test.ts` 内联对象类型里的 `unknown[]`）。纯类型注解改写，零运行时语义变更；tsc --noEmit / 暂存面 oxfmt / 脚本档基线（13 处存量不动）全绿。这是「每规则一个 PR」机械批的第一条（接 #2685 foundation / #2699 SAFETY）。
