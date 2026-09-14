## Fixed

- **项目画布与工作流画布 / 节点编辑器的表面跟随主题（ISSUE #75 重灾区）**：`MaterialLibraryPanel` / `HistoryPanel` 两个侧栏、`GlobalStepLogPanel` / `WorkflowCanvasSettings` 两个面板、`ResultCard` / `ContentAssetNode` / `CanvasNodePrimitives` 等节点视图、以及 `ProjectSwitcher` / `CanvasContextMenu` / `CanvasPanelToolbar` / `CanvasToolbar` / 各类 PickChip 浮层，此前全部用 `bg-white/N` + `border-white/N` + `text-gray-*` 这套**只有暗色**的叠层：浅色主题下侧栏是「白底白卡白分隔线」（三层糊成一片）、节点里的按钮是白底白字、面板文字灰得读不出来。现统一改语义 token（`bg-panel` / `bg-card` / `bg-subtle` / `border-border-strong` / `text-ink-*`），级别色补 `dark:` 分支。浮层（右键菜单、下拉、设置面板）另加投影两态。
