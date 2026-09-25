## Fixed

- **视图层 11 处 `w-N h-N` 同值换 `size-N`（P80 棘轮下降）**：
  延续 `#1011` 引入的 P80 判据「视图层 w-N 与 h-N 同值应换 size-N」，本批
  按域分片起手迁 3 个高频文件：
  - `components/studio/project-canvas/EmptyCanvasHint.tsx` 4 处（空画布引导
    卡里四色渐变方块 `h-10 w-10` → `size-10`）；
  - `components/studio/HomePage.tsx` 5 处（快捷动作药丸 / 最近项目卡的
    kind icon 容器 / 缩略图 / 骨架块 / 骨架条 `h-10 w-10`、`h-9 w-9` →
    `size-10`、`size-9`）；
  - `components/studio/canvas/SubgraphHeader.tsx` 2 处（折叠按钮 `h-5 w-5`
    与下钻按钮 `h-6 w-6` → `size-5`、`size-6`）。
  `size-N` 是 tailwind 内建、与同一份 `w-N h-N` 视觉**完全等价**；shadcn
  `styling.md` 原则：`Use size-* when width and height are equal`——把
  「两个方向独立设」的写法收敛成「一个尺寸一档」，改主题/改尺寸只动一处。

  基线随之下调：`scripts/.ui-primitives-baseline.json` total 197 → 186
  （P80 从 91 处降到 80 处）。剩余 80 处按域分片继续降。
