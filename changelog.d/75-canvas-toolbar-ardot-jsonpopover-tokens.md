## Fixed

- **浅色主题下最后一批写死暗色表面**：项目画布浮层工具条、节点 JSON 浮层的 accent/chip 色、工作流节点设计稿参考件（`WorkflowNodeArdot`）的类型 chip 载体底与「本机」状态点，原先写死 `#16121f` / `#1E1A2E` / `#331A28` / `#33D499` 等值，切到浅色后仍是暗底或对比度不足。现改为语义 token（新增 `--color-chip-type-image-bg` / `--color-chip-type-video-bg` / `--color-status-online`），Dark 观感不变。
- **项目画布工具条上有个语法坏掉的历史 class**（`to-surface-20]/85`，不是合法 Tailwind 类），随本次收口一并清掉。
