## Changed

- **工作流编辑器：把 `workflow-canvas-io-isolation.test.ts` 改名为 `workflow-canvas-io-isolation-guard.test.ts`。** 这条是源码级架构守卫（锁「编辑器画布只画工作流图、对外参数映射只在工作流库页签」），原名容易被误读成缺一个同名 `workflow-canvas-io-isolation.ts` 源文件；改名显式点明守卫身份，与仓库里 `check-*.test.ts` 等守卫测试命名一致。同步更新两处按文件名引用它的注释（`WorkflowParamCardColumn.tsx`、`WorkflowParamCard.tsx`）。无行为变更、测试仍按 `*.test.ts` 命中并照常通过。
