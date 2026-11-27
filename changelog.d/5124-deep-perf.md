## Changed
- 深度性能收口（#5124）：`task.list` 的三次 COUNT 合并为一条 GROUP BY（总数由分组求和，口径与独立 count(*) 等价）；`task.workflow` 归属校验与快照读取合并成一条窄投影查询，不再把同一 MB 级 workflowSnapshot 反序列化两遍；画布历史面板与历史页同口径，4s 轮询内容不变时沿用旧数组引用，80 行不再全量重渲；历史详情弹窗的派生（workshop / workflow 参数、参考图）按依赖 memo 化，`deriveWorkshopParams` 复用已算好的参考图，避免每次父级重渲都做 O(IO²) 查表与整份快照扫描。同批补 count 等价性、单查归属、轮询引用稳定用例。

**边界**：开发态 React（`jsxDEV` / `logComponentRender` / StrictMode 双渲）仍是 trace 里最大的开销来源，属框架行为，本笔不碰；真实帧率收益需在交互态用 `pnpm perf:trace` 复核，本仓无 FPS 断言判据。
