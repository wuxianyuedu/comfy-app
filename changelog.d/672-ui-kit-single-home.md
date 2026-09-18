## Changed

- **UI kit 目录只剩一处**（ISSUE #672 P1/P2/P3 收官，规范 16 §16.2.4.3）：`components/studio/ui/`（11 个）
  并入 `components/ui/` 并转 kebab-case，`components/studio/shared/` 拆成两半 ——
  **跨域通用件**（`segment-popover` / `validation-error-list` / `seed-mode-button`）进 `components/ui/`，
  **工作流参数表单专有的复合件**（`DimensionControl` / `GroupedControls` / `WorkflowFormControls` /
  `PortHandle` / `DynamicWorkflowForm`…）进 `components/studio/workflow-form/`，
  `workflow-io.ts` 与 `useMiniMapJump.ts` 收进 `components/studio/` 域根。
  分工口径：**跨功能复用 → `ui/`；域内复用 → 本域目录** —— 全塞进 `ui/` 会让
  「工具生成、可 `shadcn add` 重生成」这条口径失真。
- 重命名与新家对齐：`ModalDialog` → `ConfirmDialog`、`DarkSelect` → `SelectMenu`。

## Fixed

- **自搓浮层再清 4 处**（规范 16 §16.2.3 P2）：`SelectMenu` / `SegmentPopover` /
  `SeedModeButton` / `MultiModeSelect` 各自的 `createPortal` + fixed 定位 + 滚动重定位 +
  手写 Esc / 外点关闭 + z-index 魔数全部改为 `ui/popover` —— 翻上翻下、收边、
  重定位、关闭语义由 base-ui 的 Positioner / Root 承担，不再有第二份实现。
- **`LoadingSkeleton` 自写 `animate-pulse` 改为 `ui/skeleton`**，`ConfirmDialog` 的
  内联转圈改为 `ui/page-loading` 的 `Spinner`（P3 全库清零）。
- **`floating-position.ts` 整体删除**：浮层迁移完成后它只剩自己的单测在用，
  同一件事（摆位）已由 Positioner 承担，再留一份自有实现就是第三份口径。
- `ui/select-menu` 引用 `focus:border-violet-500/40`、`ui/json-viewer` 引用
  `focus:border-violet-400/60` 等写死色相改为 `primary-*` 语义 token（§3.6.2）。

## Removed

- **UI 基元棘轮的目录豁免全部归还**（`scripts/check-ui-primitives.cjs` 的 `EXEMPT_DIRS`
  只剩 `ui/` 自身实现与 `<feature>/hooks/**`）：原先整体豁免的 `studio/ui/**` 与
  `studio/shared/**` 已归并完毕，**P1/P2/P3 由此在同一口径下全库清零**，三条判据
  从「已扫描范围清零」变成真正的硬闸。
