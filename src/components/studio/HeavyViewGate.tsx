"use client";

/**
 * 重视图的「非活跃降级」闸（ISSUE #4677，#4598 的期望第 3 条）。
 *
 * 页签栈让打开过的屏**常驻挂载**（切走不卸载、保状态），代价是隐藏中的完整
 * 子树仍会随页签切换 / 父级状态 / 兄弟屏事件做 React 渲染。轮询那一半已由
 * `pauseWhenViewHidden` + `enabled: isTabActive` 收掉（#4598 已合并）；这里
 * 收掉剩下的一半：非活跃时经 React `<Activity>` 的 hidden 模式把子树藏起来
 * ——React 对隐藏中的子树**一次渲染都不做**（页签切换 / 父级状态 / 兄弟屏
 * 事件都不再触碰它），同时 fiber 状态原样保留（表单草稿、展开态、已加载的
 * 数据都在），切回时原样恢复；effects 重挂与 React Query 的
 * `enabled: isTabActive` 同一拍，回来即拿新鲜数据。
 *
 * 为什么经 `<Activity>` 而不是「条件渲染成轻量占位」：后者把组件内部状态
 * 全部丢掉——表单草稿 / 展开态正是本条约束点名要保的；Activity 是平台给
 * 的同名能力（React 19.2+），状态保留是它语义的一部分。
 *
 * 滚动位置（约束点名的另一项）：本仓锁定的 React 19.3 里，Activity 的
 * hidden 是**保留 DOM、置 `display:none`**（实测，见 HeavyViewGate.test.tsx
 * 的滚动用例）——scrollTop 原样留存，切回即恢复，不需要任何回放代码。
 * 若未来 React 改成真摘 DOM，这里的滚动用例会当场红，届时再补回放。
 */

import { Activity, type ReactNode } from "react";

export function HeavyViewGate({
  active = true,
  children,
}: {
  /** 是否当前页签；缺省 true（无页签语境的渲染路径按「就是当前屏」处理）。 */
  active?: boolean;
  children: ReactNode;
}) {
  return <Activity mode={active ? "visible" : "hidden"}>{children}</Activity>;
}
