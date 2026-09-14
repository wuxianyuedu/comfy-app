## Fixed

- **Light 主题下「结构性表面写死暗色」的最后一轮收口（ISSUE #75）**：上一批
  已把画布/清单/工坊等视图铺开，这一轮清掉同型漏网的兄弟位置 —— 它们都不是
  「有意保留的暗色」，而是「忘了适配」。逐处改随主题 token：

  - **项目画布**（`ProjectCanvas.tsx`）：`MiniMap` 遮罩写死 `rgba(5,5,7,0.78)`、
    `Background` 点阵 `rgba(255,255,255,0.08)`、`Controls` / `MiniMap` 的
    `#0D0818` / `#0B0712` 背景与 25% 白边框 —— Light 下两条浮层仍是黑块、
    点阵是白点压白底（网格消失）。改 `--color-canvas-minimap-mask` /
    `--color-canvas-grid-dot`，并移除组件侧写死覆盖（`Controls` 的配色已由
    `globals.css` 的 `.react-flow__controls*` token 规则统一负责，与工作流
    画布同口径）；
  - **工作流画布底色**（`WorkflowCanvasDecorations.tsx`）：`CANVAS_BG` 写死
    `#0a0a0f`，Light 下整块画布（以及缩到极限时唯一可见的底色）仍是黑的。
    改 `var(--color-canvas)`；
  - **画布标尺 / 连线中点圆点**：标尺文字 85% 近白 + 深色 `text-shadow`、
    连线中点纯白圆点，浅色画布上直接消失。改 `--color-canvas-ruler-ink`
    `-shadow` / `--color-edge-hub-dot`；
  - **端口内圈高光**（`flow-focus-endpoints.ts` 的 `portDotGlow`）：25%~50%
    白在浅色下是白描白 —— 与已修的端口圆点描边同一根因。改
    `--color-port-halo-ring` / `-weak`；
  - **子图标题栏**（`SubgraphHeader.tsx`）：`mixHex` 基准写死 `#16161E`，
    浅色节点配黑标题栏。改 `--color-node-mix-base`（经 `useCssColorToken`
    解析成 hex 后再混色 —— `mixHex` 只吃 hex，喂不进 `var()`）；
  - **节点卡片细节**（`FlowNodeHeader` / `PackageFooter` / `WorkflowParamCard`）：
    写死的 6% 白分隔线、50% 白说明文字 + 22% 白边框，统一改语义 token；
  - **`CodeBlock`**：shiki 主题写死 `one-dark-pro`，Light 下是「暗色主题的
    token 色压浅底」。改为按 `resolvedTheme` 在 `one-dark-pro` /
    `github-light` 间切换，行号与兜底色改 token；
  - **`JsonViewer`**：`react18-json-view` 传 `dark` prop + 一份写死暗色的
    `jv-theme-comfy` 语法色（`-300` 档亮色 + 4% 白 hover）——Light 下对比度
    普遍低于 AA。改两态 `--json-view-*` token，并删掉组件里那份与
    `globals.css` 重复且已脱钩的死副本；
  - **便签节点 Markdown**（`lib/comfyui/markdown.ts`）：内联 style 写死
    `rgba(255,255,255,…)` 边框 / `#f4f4f8` 标题 / `#7aa2ff` 链接，改
    `--color-md-*` token；
  - **训练进度环底轨**（`TrainingStudio.tsx`）：`rgba(255,255,255,0.08)` 在
    浅色卡片上是白描白，改 `--color-border-strong`；
  - **自定义节点设置弹窗**（`NodePreviewCard` / `SettingsParts` / `NodesTab`）：
    卡片表面写死 `rgba(15,10,30,0.95)`、端口名近白色 `#CFE9FF`/`#E7E2FB`、
    两个状态徽标写死灰/红 —— 弹窗容器已是 `bg-canvas-deep`，卡片却是黑块。
    改 `--color-card` / `--color-border-strong` / `--color-ink-*` 与
    `bg-*-/NN text-*` 两态写法（与同列表的兄弟徽标同口径）；
  - **工作流库输出参数卡**（`WorkflowOutputParamCardColumn.tsx`）：端点圆点
    描边写死 `#16161C`，改 `--color-port-surface`（与画布端口圆点同口径）。

- **防回退**：`globals.css` 的「已明确不属于固定暗色」反例表、规范 03
  §3.6.1 的反例表同步补入以上条目；主题色扫描器棘轮基线由 239 处收紧到
  **184 处**（`scripts/.theme-color-baseline.json`）。
