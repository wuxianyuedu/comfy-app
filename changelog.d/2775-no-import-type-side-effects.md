## Changed

oxlint `typescript/no-import-type-side-effects` 全仓清零（#2775）：42 处 / 34 份，`import { type A, type B }` → 顶层 `import type { A, B }`（`--fix` 一次收敛，无手工补丁）。

`verbatimModuleSyntax: true` 下这两种写法在运行时并不等价：前者会留下 `import {} from "…"`（模块仍被求值），后者整条消失。因此逐条核对了全部被引目标：本地模块（`NavItems`、`workflow-io`、`workspace-tabs`、`~/trpc/react`、各类型模块等）均无加载期副作用，三方包（`next`、`react`、`@xyflow/react`、`drizzle-orm`、`@trpc/server`、`class-variance-authority`）亦无注册类副作用，转换前后行为一致。

eslint 侧 `@typescript-eslint/consistent-type-imports`（`fixStyle: inline-type-imports`）对顶层 `import type` 不报错，34 份全部复跑通过；`tsc --noEmit` 通过；3 份文件按「谁碰谁迁到 100」由 oxfmt 收窄。
