## Fixed

- **画布上「深色表面写死」的一批硬编码色值统一改随主题（ISSUE #75 清单 C2 类）**。这些是**表面与文字**语义的写死色值（不是类型色，见清单的「类型色例外」），浅色主题下会整片保持暗色或直接看不见：
  - **工作流节点卡片** `canvas/workflow-node-palette.ts`：卡片 body / header / border / title / dot 原本写死 `#16161E` / `#1A1A22` / `rgba(255,255,255,0.20)` / `#E2E2EA` / `#6b7280`，浅色下节点仍是一张近黑卡。改为按 `resolvedTheme` 取 `LIGHT_PALETTE_BASE` / `DARK_PALETTE_BASE` 两组基准，混色逻辑（角色色 22%/8% / 模式色 16%/11%）保持不变。
  - **收起态锚柱**（`FlowNodeCollapsedAnchors` / `WorkflowSubgraphNode`）：`#d4d4d8→#52525b→#18181b` 渐变 + 45% 白描边在浅色下是**白描白**，锚柱整个消失。抽出 `resolveAnchorCylinder()` 两态主题，浅色改用中灰柱 + 深边。
  - **工作流顶栏**：`rgba(10,10,15,0.85)` 让顶栏在浅色下整条还是黑的（与 #508 修的底部状态栏同型）→ `color-mix(--color-panel 85%)`；根工作流名 `#F4F4F8` + 黑投影 → `text-ink-bright`。
  - **节点 JSON 弹窗** `WorkflowNodeJsonPopover`：弹层表面/分隔线/底衬全是 `rgba(255,255,255,0.01~0.06)`，浅色下弹层看不出边界 → 语义 token；统计 chip 的中性灰 `#a1a1aa` → `CHIP_NEUTRAL_COLOR`（`--color-ink-muted`），弹窗遮罩 → `--color-canvas-minimap-mask`。
  - **`RgthreeBodies`**（Power Lora Loader / Fast Groups Bypasser）：整片 `rgba(255,255,255,0.04~0.85)` 的白字白底 → 语义 token。
  - **便签节点** `WorkflowEditorNodes`：混色基准从写死 `#22222c` 改为 `--color-note-tint-base`（浅色 = 白、深色 = 原值），用户在便签上选的颜色是内容色、保持不变；便签正文 `#e6e6ea` → `text-ink-bright`；重投影与端口兜底点也改 token。
  - **`WorkflowNodeArdot`**（项目画布节点设计稿）：中性 type chip 底/字、端点描边、W 图标底、本机 chip 亮绿字补两态。
  - 端口行行底 `rgba(255,255,255,0.015)` → `--color-subtle`。

## Added

- 新增三个语义 token（都在 `@theme` 内，utility 实测 emit）：`--color-overlay-accent-surface`（浮层强调底）、`--color-shadow-strong`（浮层重投影，浅色不再是 55% 黑）、`--color-note-tint-base`（便签混色基准）。
- 新增 `useCssColorToken()`（`components/studio/hooks/use-css-color-token.ts`）：给「需要在 JS 里参与色彩运算」的位置读随主题的 token 解析值，随 `resolvedTheme` 重算 —— 这类位置喂不进 class（`mixHex` 只吃具体色值）。
