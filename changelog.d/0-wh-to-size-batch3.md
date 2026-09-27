## Fixed

- **视图层 10 处 `w-N h-N` 同值换 `size-N`（P80 棘轮 70 → 60，第三批）**：
  - `workflow-library/sections/DetailHeader.tsx` 6 处（详情页操作栏
    6 个 `<ActionButton icon={<Xxx className="h-3.5 w-3.5" />}>` 全部
    → `size-3.5`）；
  - `canvas/WorkflowSubgraphNode.tsx` 4 处（子图节点的折叠态端口圆点
    `!h-2 !w-2` 与展开态端口 `!border-port-surface !h-2.5 !w-2.5`
    分别 → `!size-2` / `!size-2.5`，`!` 前缀保留、`size-N` 与
    `w-N h-N` 在 tailwind important 下等价）。

  基线 176 → 166（P80 累计 91 → 60）。
