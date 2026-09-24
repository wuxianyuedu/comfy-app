## Fixed

- **步骤日志面板的任务序号每帧 O(缓存任务数 × 节点数)（`src/components/studio/project-canvas/GlobalStepLogPanel.tsx`）**：
  `useNodes()` 订阅的是整份节点数组，画布拖拽 / 平移每帧都会换引用 → 那段
  `useMemo` 每帧重算，而它对每个缓存任务各做一次 `nodes.findIndex` 去定位序号。
  改为复用 `project-canvas/node-seq.ts` 的 `nodeSeqOf`（按帧记忆的 `id → 序号`
  映射）：整帧只建一次表，其余是 O(1) 查表，与画布节点头部那处序号共用同一算法。
