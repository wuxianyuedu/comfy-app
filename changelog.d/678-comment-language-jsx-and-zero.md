## Added

- 注释语言棘轮纳入 **JSX 注释块**（`.tsx` 里的 `{/* … */}`）：此前的判据只认行首
  `/*` 与 `//`，而 JSX 注释行首是 `{`，于是那批注释**从未被扫描** —— 既不被统计、
  也不被拦下，棘轮数字还一直显示「很干净」（实测全仓有 125 个英文 JSX 注释块 /
  42 个文件）。现在与块注释同判、逐行计入，配两条回归用例（英文计入 / 中文不计入 /
  多行块逐行计入）。判据本身变了，`RULE_VERSION` 1 → 2、基线一次性重记
  （规范 12 §12.4.6 豁免表已登记）。

## Changed

- **源码注释全部中文化，棘轮基线归零**（ISSUE #678）：本轮把剩余的全部英文注释逐条
  改写为中文，`scripts/.comment-language-baseline.json` 由 1668 行 / 175 个文件降到
  **0 行 / 0 个文件**。范围覆盖 `src/components/studio`（画布 / 工作流编辑器 /
  工作流库 / 项目画布 / 工坊）、`src/app` 与 `src/server` 路由、`src/trpc`、
  `src/env.js`、`scripts/**`（含 `launcher-core`）与 `tests/**`。
  「为什么这样写」的因果链一律保留（如标题栏锚点换算、`WorkflowEdge` 的曲线算法
  取舍、视口裁剪的性能理由）；工具指示注释（`eslint-disable*` / `@vitest-environment`
  / `turbopackIgnore:` 等）仍整行豁免 —— 改成中文是**静默失效**。

## Fixed

- 顺带清掉若干**指向别处的过期注释**与注释里的改动流水（规范 §12.4.2 的 G4）：
  `RequiredSummary.tsx` 残留的 rgthree 运行时说明与 `NodeIdChip` 说明（实现与组件
  已在别的文件）、`WorkflowWirePortRows.tsx` 的 `R-ardot17 (2026-08-14)`、
  `CanvasNode.tsx` 与 `WorkflowSubgraphNode.tsx` 的日期与过期行号引用（如 `L4415`）。
