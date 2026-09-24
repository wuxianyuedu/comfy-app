## Fixed

- **画布节点的「短序号」选择器每帧 O(N²)（`src/components/studio/project-canvas/WorkflowNode.tsx`）**：
  每个节点都在自己的 `useStore` 选择器里对 `state.nodes` 做一次 `findIndex`，而选择器
  **本体**在 store 每次更新时都会执行 —— 拖拽 / 平移每帧都换一份新的 `nodes` 数组，
  于是 N 个节点 × O(N) 就是每帧 O(N²)，节点一多画布就拖不动（原先注释里
  「拖动只改位置不改 index、所以不会重渲染」只对**渲染**成立，挡不住选择器执行）。
  序号算法收进新的 `project-canvas/node-seq.ts`：按「节点数组引用」记忆整张
  `id → 序号` 映射，同一帧内只有首个查询的节点重建一次（O(N)），其余节点直接查表
  （O(1)），整体降回每帧 O(N)。日志面板的任务切换器下一处 `findIndex` 一并复用它。
