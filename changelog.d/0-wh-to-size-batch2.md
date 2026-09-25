## Fixed

- **视图层 10 处 `w-N h-N` 同值换 `size-N`（P80 棘轮 80 → 70，第二批）**：
  延续 `#1015` 起手，本批再迁 3 个高频文件：
  - `project-canvas/MaterialLibraryPanel.tsx` 4 处（Skeleton 与列表 kind icon
    容器 `h-9 w-9`、缩略图容器 `h-9 w-9`、下载按钮 `h-7 w-7` → `size-9` / `size-7`）；
  - `project-canvas/HistoryPanel.tsx` 3 处（Skeleton / 缩略图容器
    `h-10 w-10`、下载按钮 `h-7 w-7` → `size-10` / `size-7`）；
  - `project-canvas/WorkflowNodeArdot.tsx` 4 处（端口小圆点 `h-3 w-3`、
    类型 icon 容器 `h-7 w-7`、状态指示小圆点 `h-1.5 w-1.5` ×2 → `size-3` /
    `size-7` / `size-1.5`）。
  基线随之 186 → 176（P80 累计 91 → 70）。
