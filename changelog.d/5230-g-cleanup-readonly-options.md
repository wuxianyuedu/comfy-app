## Changed

- **低影响清理：常量词表与只读数组直接传给下拉/行部件，不再在渲染期浅拷贝（ISSUE #5230）**：`SelectMenu` 与 `WorkflowNodeOutputsRow` 的入参类型放宽为 `ReadonlyArray`，9 处调用点去掉 `[...CONST]`；搜索结果排序的 `useMemo` 依赖按 catalog 引用收窄。纯写法收敛，不改变行为。
