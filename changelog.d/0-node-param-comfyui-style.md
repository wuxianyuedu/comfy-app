## Changed

- **工作流节点编辑的节点参数行改为 ComfyUI 同款版式**：去掉参数名与参数值之间的 1px 竖线；参数值（含数值步进器输入框、子图节点与 rgthree 行）统一左对齐；暗色下参数值颜色改为「未连线纯白、已连线比纯白暗一档」（不再按 JS 类型分色为琥珀/靛蓝/红绿），值色走语义 token `--color-widget-value` / `--color-widget-value-dim`，浅色档不照抄白。
- **节点框背景在暗色下由近黑改为灰**：`--color-node`（含子图标题栏混色基准 `--color-node-mix-base`）与画布节点调色板 `DARK_PALETTE_BASE` 从 `#16161E` 提到 `#2B2B36`，解决节点框与黑色画布底几乎同深、看不清边界的问题（浅色档不变，仍是 `#ffffff`）。子图节点的 widget 区同步取 `bg-node`，不再出现「灰框里的黑块」。
