## Changed

- **节点头部右侧胶囊的两处手写改走 `WorkflowNodePill`**：`project-canvas/WorkflowNode.tsx:183`
  与 `project-canvas/WorkflowNodeArdot.tsx:238` 各自重抄了一遍
  `flex h-5 shrink-0 items-center gap-1.25 rounded-[11px] px-2`，而这个形状**早就有具名件**
  （`workflow-form/WorkflowNodeParts.tsx` 的 `WorkflowNodePill`，文件头明写「两侧只允许组合、
  不允许复刻」，库卡 `LibraryHostCard` 就是走它的）。所以这一刀不新增基元，只是停止复刻
  （规范 §12.18：有等价实现先 import，缺的差异用参数补）。
- `WorkflowNodePill` 补一个 `className` 出口：画布节点那枚的底色是
  `--color-overlay-accent-surface`（浮层强调底），而件里是 `--color-node-accent`
  （节点强调底）。**两档不并成一颗** —— 浅色只差 1/255（`#f2eeff` vs `#f1edff`），
  暗色差得明显（`#1e1a2e` vs `#241f38`），且语义一个讲节点、一个讲浮层；借去重把它们合成
  一颗是改设计而不是改代码。实测 `cn()` 认 `bg-<名>` 为同一组、后写的赢，所以差异由调用点
  追加一个类即可，零像素变化。
- `rounded-[11px]` 留在件里是刻意的：11px 不在圆角七档上，它的形状来自这枚胶囊自己的
  `h-5`（20px 高），不跟设置页的基数走 —— 与 `TypeChip` 那枚 `rounded-[3px]` 同一类判断。

## Added

- **防回潮判据收进同一张表**：`tests/design-md-contract-sync.test.ts` 里那三条
  「只许有一个出处」改写成一份 `FAMILIES` 表（序号圆 / 类型 chip / 节点右侧胶囊），
  三族共用一次目录遍历（923 个文件 × 每族一遍太贵），新增一族只加一行。每族带一份
  **手抄样本**作负控制（标记写漂了这条会静默全绿，那比红更糟），并新增一份反向样本
  （`WorkshopStageItem` 那枚 11px 的 `grid size-9` 图标方块不许被胶囊标记误抓）。
- 字面圆角棘轮 **12 → 10**（实测读数；字面字号 298 不变）。
