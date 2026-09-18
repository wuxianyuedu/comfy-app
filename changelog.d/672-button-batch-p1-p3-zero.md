## Changed

- **P1 按钮分批收官：视图层手写 `<button>` 与自写 spinner/pulse 双双清零** —— 棘轮基线 235 → **0**（`scripts/.ui-primitives-baseline.json`）。本批共 74 个文件、170 处手写 `<button>` + 24 处 `animate-spin`/`animate-pulse`：`workshop/`（`WorkshopModelAdapterModal` 9、`LLMContext` 8、`CharacterPortraitStudio` 7、`WorkshopHeader` 7、`ShotStudio` / `VideoStudio.parts` / `ModeContractEditorView` 各 6）、`studio/` 散件（`FilmStudio` 9、`ModelLibrary` / `TrainingStudio` / `VideoQueueModal` 各 8、`HomePage` 6 等）、`app/login/page.tsx`（8）、`message-center/`、`model/`。

  **三条判据都从棘轮变成硬闸**：基线里已无条目，新增任何自实现（手写按钮 / 自建 portal 浮层 / 自写 spinner）直接被 pre-commit 第 12 步阻断，`--strict` 下基线上调即失败。

- **P3 加载态收口**：`Skeleton` 接管 7 处骨架占位（`HistoryPanel` / `MaterialLibraryPanel` / `ModelLibrary` ×2 / `WorkshopStageBody`）；`StatusDot` 接管 9 处枚举状态圆点（`BrowserStatusBar` 的 dev server 灯、`LibraryHostCard` 的节点相位点、`WorkflowRunLogButton` 的「跟随中」点、`CustomNodesSettings` 的两处「解析中」点、`AgentOverlay` 的三个「正在输入」点）；`Spinner` 接管按钮内联转圈（上传 / 扫描 / 同步 / 关闭 Agent）；`PageLoading` 接管 `dynamic()` 的 `loading`（`WorkflowLibrary`）。定妆照的无限进度条改走 `ui/progress` 的 `value={null}`（base-ui 的不确定进度），不再自写 `animate-pulse` 满宽条。

- **配色随转换一并收口到语义类名**（规范 03 §3.6.2）：本批触碰到的 `violet-*` / `emerald-*` / `amber-*` / `sky-*` / `rose-*` / `red-*` / `cyan-*` / `fuchsia-*` 字面量全部换成 `primary-*` / `success-*` / `warning-*` / `info-*` / `danger-strong` / `destructive`。含 `from-violet-500 to-fuchsia-500` 这类渐变起点（`HistoryList` 的筛选 pill、`AgentOverlay` 的唤醒球）。

- **`ui/button` 的 `variant` 不强行接管所有配色**（规范 §16.2.4.2 第 9 条）：无底色 / 行内 `style` 驱动 / mono 徽标类的调用点一律 `variant="ghost"|"outline"` + 原 `className`，转换的验收标准是**渲染结果不变**（3 个快照断言随转换更新，逐处核对过差异全是基元类名，无语义变化）。

## Fixed

- **`ui/sheet` 的 `SheetContent` 让出顶栏这条硬规则（ISSUE #310）在本批被看见**：两个设置抽屉此前各自 `FullScreenLayer` + 遮罩按钮 + 手写 Esc，换成 `ui/sheet` 后 `dialogBackdropClass()` 统一承载「顶部让出标题行」，页签与窗口按钮不再被遮罩盖住。

- **`WorkshopStageBody` 的懒加载占位从 `animate-pulse` 换成 `Skeleton`**：它此前是自绘的 `border + bg-surface` 占位块，与 `ui/skeleton` 的用法不一致 —— 版面高度契约（`min-h-[260px]`）保留，观感交给基元。

## Docs

- `docs/standards/16` §16.2.3（三条判据收于硬闸 + 豁免归还约定）、§16.2.4（台账：按钮 / 加载态两行标为已完成）、**§16.2.4.2 新增第 9~13 条口径**（变体只在语义对得上时接管配色 / `role="switch"` 照换 / 枚举圆点走 `StatusDot` / 骨架走 `Skeleton` / `Progress value={null}` 表示不确定进度），并写明 `studio/ui/` 与 `studio/shared/` **仍未**纳入扫描（不把「清零」说成半真）。
