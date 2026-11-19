## Fixed

- **画布 `taskNodeMap` 加 LRU 上限（#4007）**：`activeTask.ts` 的 taskId → nodeId
  模块级映射此前只增不删（`clearTaskNodeMapping` 生产零调用、无容量上限）——桌面
  应用常驻数天、数千次生成后慢性吃内存。现在上限 256 条、超限按「最久没写过」淘汰
  （与 `runner-state` 的 `touchAndEvict` 同一形态）。可终止性审计 #3889 的 P3 项。
