/**
 * 浮层层级（z-index）的两条刻度 —— 规范 16 §16.2.3 P2。
 *
 * 背景（ISSUE #672 P2）：把各个自搓浮层收拢到 `ui/dialog` / `ui/popover` /
 * `ui/sheet` 的过程中暴露出第二处不一致 —— **层级各处一套魔数**：同一件事
 * （下拉浮层）在 `MultiSegmentPopover` 里是 `9999`、`WorkflowSeedModeButton`
 * 是 `9999` 配 `9998` 遮罩、`DarkSelect` 又是 `9999`，而节点 JSON 浮层用
 * `9000`/`9001`，全屏抽屉散落 `10005`/`10020`。谁也说不清「它比谁高」，
 * 新增一层只能再编一个更大的数。
 *
 * 收敛为两条刻度（数值同时定义在 `globals.css` 的 `@theme`，供
 * `z-overlay` / `z-toast` 工具类使用；本模块供需要行内 `zIndex` 的场合，
 * 两处数值必须一致）。放在 `lib/shell`：它是**客户端可达**的跨端定层常量 ——
 * `lib/core` 在 eslint 的 boundaries 里是 element `server`，视图层引不得。
 *
 *  - `Z.overlay` 应用内浮层：下拉 / 抽屉 / 对话弹窗 / 内嵌浮层。**不进
 *    1000~1200 区间** —— 那是 React Flow 给节点选中态（约 1010）与悬浮态
 *    （1180，见 `globals.css`）留的位，应用浮层插进去会和节点争层级。
 *  - `Z.toast` 全局提示：任何浮层之上。
 *
 * 画布内部元素的层级（节点 10 / 子图 11 / 子图内元素 0~5）**不属于**本刻度：
 * 它们只在 React Flow 的层叠上下文里比较，与全屏浮层不在同一维度。
 */
export const Z = {
  /** 应用内浮层（下拉 / 抽屉 / 模态 / 调试面板）。 */
  overlay: 100,
  /** 全局提示（Toast 等），恒在浮层之上。 */
  toast: 1000,
} as const;
