## Changed

- **日志面板关闭时停算整页布局（性能）**：`src/components/studio/logs/LogPanel.tsx`
  在根布局里**永远挂载**，`if (!isOpen) return null` 的闸门位于所有 hooks 之后。
  LogProvider 每 2s 轮询一次日志、每次有新行落板都重建 `header`，于是即便面板不可见，
  下面这几个 memo 仍照跑整页重活：`selectPageLogs`（分页切片）、`selectFirstPageWindow`
  （锚定窗口）、`dedupeRepeats`、`layoutRows`（最多 2000 行的估高前缀和）、`rowWindow`。
  ComfyUI 跑图日志高频滚动期，这就是每 2s 一次的固定 CPU 税，且与画布拖动帧争主线程
  （规范 §2.1.1「State 里数组过大 → 过滤/遍历每次全量扫描卡顿」）。现引入
  `viewLogs = isOpen ? filteredLogs : NO_LOG_ENTRIES`（模块级稳定空数组常量），把三个
  上游 memo 的输入换成它——关闭态输入引用恒定 → memo 全部短路、下游 dedupe/layoutRows
  随之退化为常量。开启时 `viewLogs === filteredLogs`，行为与渲染完全不变；
  `LogPanel.test.tsx` 等定向用例 240 passed 确认。store 侧的 `computeFiltered`
  是另一处成本，需 Profiler/实跑取证，未纳入本 PR。
