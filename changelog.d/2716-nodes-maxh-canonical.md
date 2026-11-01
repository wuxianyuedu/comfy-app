## Fixed

- **NodesTab 的滚动容器类回归 spacing 规范形**（ISSUE #2716）：#2548 的窗口化视口写成了
  `max-h-[480px]`（任意值），spacing canonical 硬闸判它等价于 `max-h-120`。改写后硬闸
  0 处（该判据不在 pre-commit / PR 流水线，按需档 --check 现场读数）。
