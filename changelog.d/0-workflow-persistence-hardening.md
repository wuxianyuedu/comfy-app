## Fixed

- **工作流编辑器：`use-workflow-persistence` 清除死参数与静默失败。** 移除从未被读取的 `scopeDetail` 入参及其误导性的「无 scope 即空操作」守卫；拖拽落盘失败现在经 `WorkflowSaver.mutate` 的 `onError` 暴露为 toast + 日志（满足规则 #4：失败路径必须有日志与用户可见出口）；`onNodeDragStop` 改回使用 `@xyflow/react` 的 `Node` 类型而非手写结构类型；把每次拖拽重建的锚点偏移表与「双 rAF 等绘制」魔法提到模块级常量/助手；顺手清掉注释里的任务批次号（`P4 split`）、`late`、`不再区分 RAW / API 视图` 等历史流水气味（规则 #12）。
- **工作流编辑器：`use-workflow-save` 类型收口。** `WorkflowSaver.mutateAsync` 的返回类型从 `Promise<unknown>` 收紧为 `Promise<RouterOutputs["workflow"]["update"]>`，不再丢失 tRPC 输出类型；`mutate` 的 `options` 内联结构抽成具名类型 `WorkflowSaverMutateOptions`，接口声明与实现共用、后续扩展只改一处（规则 #12.12 去重精神）。
