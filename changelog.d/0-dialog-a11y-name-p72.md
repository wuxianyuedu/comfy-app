## Fixed

- **模态对话框 / 抽屉缺可访问名（8 处 DialogContent + 1 处 SheetContent）**：
  项目自陈"弹窗形态约定是自绘 header + 关闭"，多数落点用 `<DialogContent aria-label="…">`
  补上可访问名（shadcn composition.md 允许这种写法）。但仍有 9 处**既没有** `<DialogTitle>`
  / `<SheetTitle>` 组件、**也没有** `aria-label` / `aria-labelledby` —— base-ui 在这种
  情况下不会自动补 `aria-labelledby`，读屏器进模态只能播报"对话框"、上下文完全丢失。
  本批逐个补 `aria-label`：`WorkshopModelAdapterModal`（模型适配器）、
  `RemoteModelDialog`（编辑/添加模型，按 `dialog.mode` 动态）、
  `ModeContractDialog`（模式契约）、`UsageTestDialog`（实际调用测试 · 按 kind 动态）、
  `LLMContext`（模型选择）、`CustomNodesSettings`（导入自定义节点）、
  `WorkflowRunRawCliModal`（comfy-cli 完整输出）、`WorkflowRunLogModal`（执行日志）、
  以及 `ProjectOutputs` 的 `<SheetContent>`（产出 #<id后4位>）。

## Added

- **UI 基元棘轮新增 P72「模态无可访问名」（硬闸，`scripts/check-ui-primitives.cjs`）**：
  按标签块扫 `<DialogContent>` / `<SheetContent>`，块内既无对应 `<DialogTitle>` /
  `<SheetTitle>` 又无 `aria-label` / `aria-labelledby` 即计 1、非零即阻断。判据走
  `HARD_GATE_RULES`，本批清零后新增即拦；`ui/` 层通过 `EXEMPT_DIRS` 短路，
  `dialog.tsx` / `sheet.tsx` / `confirm-dialog.tsx` / `fullscreen-dialog.tsx`
  等基元自身实现不受影响。差分回归见 `tests/check-ui-primitives.test.ts`：
  正例（裸 DialogContent / 裸 SheetContent）+ 反例（有 DialogTitle、有 aria-label、
  有 aria-labelledby）+ 一个文件多模态各计一次。对齐 shadcn composition.md
  "Dialog, Sheet, and Drawer always need a Title" 与 WCAG 4.1.2 (Name, Role, Value)。
