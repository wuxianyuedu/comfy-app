## Changed

- **`components/studio/` 目录 12 处 raw `<input>` / `<textarea>` /
  `<input type="checkbox">` 迁到 shadcn 基元**（P68/P69 治理 · studio 域，
  workshop 域之后的第二片、也是最后一片）：
  - **P68 · 2 处 `<input type="text">` → `<Input>`**：
    `logs/LogFilterBar.tsx`（搜索框 + 图标 overlay + 清除按钮）、
    `project-canvas/MaterialLibraryPanel.tsx`（搜索框嵌在容器里、
    无自身边框）、`workflow-library/WorkflowLibraryList.tsx`（搜索框
    - 图标 overlay，同 LogFilterBar 形态）
  - **P68 · 4 处 `<textarea>` → `<Textarea>`**：
    `project-canvas/ContentAssetNode.tsx`（h-[260px] 固定高编辑器、
    带 `ref` + `textHandler`）、
    `project-canvas/WorkflowNodeArdot.tsx`（h-[52px] `readOnly`
    展示、`defaultValue` 非受控）、
    `StringTextarea.tsx`（`readOnly` + `useLayoutEffect` 自适应高度 +
    复杂 inline `style`）、
    `workflow-form/WorkflowFormTextarea.tsx`（`rows={1}` + `ref`
    自适应高度 + inline `style`，无边框画布字段）
  - **P69 · 5 处 `<input type="checkbox">` → `<Checkbox>`**：
    `canvas/IOEditContext.tsx`（带 `onClick` / `onPointerDown`
    stopPropagation 的 toggle）、
    `FilmStudio.tsx`（烧录字幕开关）、
    `ModelLibrary.tsx`（仅显示已启用过滤）、
    `project-canvas/GlobalStepLogPanel.tsx`（自动滚动）、
    `workflow-library/WorkflowRunLogModal.tsx`（自动滚动）
- **`scripts/.ui-primitives-baseline.json` 收紧**：P68 判据 7 → **0** 处、
  P69 判据 5 → **0** 处，合计 12 → **0**。
  **P68/P69 至此清零、变成天然硬闸**——新增任何视图层 raw `<input>` /
  `<textarea>` / `<input type="checkbox|radio">` 都会被 pre-commit 直接
  拦下、不再有基线豁免空间。
