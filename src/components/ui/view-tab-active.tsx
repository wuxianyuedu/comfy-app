"use client";

/**
 * 「这一屏现在是当前页签吗」—— 页签可见性的事实源（ISSUE #4598）。
 *
 * 由 `WorkspaceViewStack` 按页签逐个提供（打开过的页签常驻挂载、仅 CSS 隐藏）。
 * 轮询类原语（`useInterval` 的 `pauseWhenViewHidden`）与 React Query 的
 * `enabled` 门控都读它：隐藏页签不再发请求、不再因数据到达重渲染隐藏中的
 * 完整子树，多开页签后的渲染与网络税不再随页签数线性增长。
 *
 * 缺省 `true`：不挂壳的渲染路径（独立路由页、Storybook、组件用例）没有页签
 * 这回事，按「就是当前屏」处理——门控在那些路径上恒为放行，行为与从前一致。
 */
import { createContext, useContext, type ReactNode } from "react";

const ViewTabActiveContext = createContext(true);

/** 给一个页签内容标上「是不是当前页」。 */
export function ViewTabActiveProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return <ViewTabActiveContext.Provider value={active}>{children}</ViewTabActiveContext.Provider>;
}

/** 读「本屏是不是当前页签」。页签之外（独立路由 / Storybook / 组件用例）恒为 true。 */
export function useViewTabActive(): boolean {
  return useContext(ViewTabActiveContext);
}
