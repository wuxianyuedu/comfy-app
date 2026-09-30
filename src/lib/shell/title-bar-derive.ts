// 自定义标题栏（页签 + 窗口按钮）的纯逻辑判据。
//
// 为什么独立成模块：标题栏要不要启用、拖拽区如何避让可交互元素，都属于
// 「删掉 JSX 还能跑的判据」，按规范 17 §17.2 归第①层（配置 / 纯派生），
// 可脱离 React 单测；视图层只消费这些函数的结果。

/** 是否需要渲染「自定义标题栏」（即页签是否搬到窗口标题行）。
 *
 * 只有桌面壳里才有原生标题栏可让位。判据为假（浏览器 / dev）时**不是**「退回
 * 应用内页签栏」—— `ShellTabs.tsx` 在这种情况下什么都不画（浏览器自带页签栏，
 * 再画一条既占纵向空间又与原生重复），只承载 children；ComfyUI 改由新浏览器页签
 * 打开（见 `shouldUseBrowserTab`）。e2e 实测该形态下页面里 `role="tablist"` 计数
 * 为 0 —— 写这条相关的断言前先确认自己在哪种形态里。
 */
export function shouldUseTitleBarTabs(isDesktop: boolean): boolean {
  return isDesktop;
}

/**
 * 判断一个 DOM 目标是否属于标题栏的「拖拽区」。
 *
 * 拖拽区铺满标题栏，但页签、关闭按钮、窗口按钮等可交互元素必须排除，
 * 否则点击会被拖拽行为吞掉。用 `closest` 沿祖先链查找标记属性实现，
 * 避免为每个元素单独绑事件。
 */
export function isDragRegionTarget(
  target: { closest?: (selector: string) => unknown } | null,
  markerAttr = "data-no-drag",
): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return target.closest(`[${markerAttr}]`) === null;
}

/** 窗口按钮的语义类型（决定图标与动作）。 */
export type WindowButtonKind = "minimize" | "maximize" | "restore" | "close";

/** 按当前最大化状态给出「最大化 / 还原」按钮语义。 */
export function resolveMaximizeButtonKind(
  maximized: boolean,
): "maximize" | "restore" {
  return maximized ? "restore" : "maximize";
}

/** 窗口按钮的无障碍标签（中英对照的说明，供 aria-label / title）。 */
export const WINDOW_BUTTON_LABELS: Record<WindowButtonKind, string> = {
  minimize: "最小化",
  maximize: "最大化",
  restore: "向下还原",
  close: "关闭",
};
