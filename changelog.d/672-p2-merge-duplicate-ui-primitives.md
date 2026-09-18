## Changed

- **浮层与空态不再各写一份**（ISSUE #672 P2）：视图层里自建 `createPortal` 的浮层全部改走 `ui/` 原语，`check-ui-primitives.cjs` 的 P2 判据从 10 处降到 **0 处**（清零后由棘轮变成硬闸）。顺带删掉每份自搓实现里各自一套的「手写 Esc / 手写遮罩点击关闭 / 手写定位与滚动重定位 / 手写 z-index 魔数」。
  - 确认对话框 `studio/ui/ModalDialog.tsx` 改为基于 `ui/dialog` 封装，`ui/dialog` 从「业务零引用」变成真实被用；
  - 节点 JSON 浮层、源码查看弹窗、模型标签编辑器改走 `ui/dialog`；`workflow-utils.ts` 里只服务前者的 `computePos` 随之删除；
  - 属性多选下拉与 4 个工作流 chip 下拉改走 `ui/popover`，`project-canvas/workflow-node-popover.ts`（定位/外部点击关闭基元）整个删除；
  - 两个设置抽屉改走 `ui/sheet`。
- **空态三合一**：`ui/empty-state.tsx` 按并集收敛 `page` / `error` / `hint` 三态，`studio/ui/EmptyState.tsx` 与 `DynamicWorkflowForm/sections/EmptyStateHint.tsx` 的独立实现删除，消费方零改动（`emptyHint` / `minHeightClass` 等 props 原样保留）。
- **浮层层级收敛成两条刻度**：新增 `src/lib/shell/overlay-z.ts` 的 `Z.overlay`(100) / `Z.toast`(1000) 与 `globals.css` 的 `z-overlay` / `z-toast` 工具类，替换散落的 `9998` / `9999` / `9000` / `9001` 等魔数。`Z.overlay` 刻意不进 1000~1200 —— 那是 React Flow 节点选中态与悬浮态的位置。
- **遮罩样式收口一处**：`ui/dialog-overlay.ts` 的 `dialogBackdropClass()` 由 `ui/dialog` 与 `ui/sheet` 共用，承载「顶部让出标题行」的硬规则；内容层不再自绘遮罩（避免与 base-ui 的 Backdrop 叠成两层）。
