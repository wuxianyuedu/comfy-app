## Fixed

- **视图层 10 处 `w-N h-N` 同值换 `size-N`（P80 棘轮 50 → 40，第五批）**：
  - `workflow-library/sections/DetailBody.tsx` 1 处（`Maximize2` icon
    `h-3 w-3` → `size-3`）；
  - `workflow-library/WorkflowLibraryList.tsx` 2 处（`Search` 输入框前
    缀 `h-3.5 w-3.5` 与 pending 载入按钮里 `Download` `h-3 w-3`）；
  - `project-canvas/CanvasContextMenu.tsx` 2 处（零尺寸定位锚点
    `pointer-events-none fixed h-0 w-0` → `size-0`；测试节点里
    "W" 方块 `flex h-5 w-5` → `flex size-5`）；
  - `canvas/FlowNodeHeader.tsx` 2 处（折叠按钮 `h-5 w-5 shrink-0 rounded`
    与状态指示点 `inline-block h-2 w-2 shrink-0 rounded-full`）；
  - `canvas/FlowNodeCollapsedAnchors.tsx` 2 处（React Flow 折叠端口
    圆点 `!h-2 !w-2 !rounded-full` → `!size-2 !rounded-full`，
    `!` 前缀保留）；
  - `studio/ModelTagManager.tsx` 1 处（关闭按钮里 `Icon x` `h-4 w-4`
    → `size-4`）。
  基线 **156 → 146**（P80 累计 91 → 40）。视觉 0 变化。
