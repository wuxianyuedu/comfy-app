## Fixed

- **工作流编辑器下钻子工作流：画布不再停在父图，面包屑不再同名层堆叠**（#5037）：
  点击封装节点右上角的「展开子工作流」后，画布此前仍渲染父图节点，而顶栏统计与
  面包屑已切到子图 —— 用户再点就再压一层同名面包屑（「点击查看子工作流无效，导致
  上方不断嵌套」）。根因是非受控画布（#4536）下 `rf.setNodes` 走 React Flow 的
  批量队列、flush 按序归并且同批后写者覆盖先写者：下钻那一拍，画布同步 effect 先
  push 子图新图，paramMap 徽标重同步 effect（`use-workflow-persistence`）再经
  `rfSetNodes` 包装器 push 一次 —— 包装器在调用点用 `rf.getNodes()` **急切解析**
  了 flush 前的旧 store 快照，归并后旧父图覆盖了子图新图。修复：
  `rfSetNodes / rfSetEdges` 改为把 updater **透传**给 React Flow 队列
  （新 hook `use-rf-table-writers.ts`），flush 时对「当次归并中的最新图」求值，
  同批写入按序组合、不再互相覆盖。回归用例：
  `use-rf-table-writers.test.tsx`（旧实现下 2 条红、修复后全绿）。
