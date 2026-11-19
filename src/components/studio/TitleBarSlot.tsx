"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 桌面壳标题行的插槽（ISSUE #3807）。
 *
 * `TitleBarTabs` 需要 `ShellTabs` 里的应用页签 store 状态，但它要渲染在 `AppShell`
 * 的**内容列顶部**（与浏览器态 `ViewTabStrip` 同位），而不是整窗第一行 —— 否则那条
 * 36px 横条会把侧栏与内容一起推下去，两形态顶部就对不上。与其把 store 的读数和
 * 动作一路透传进 `AppShell`（那会让壳层开始管应用页签），这里让 `ShellTabs` 把
 * 已经组装好的标题行作为 ReactNode 交给下游，由 `AppShell` 决定放哪儿。
 *
 * 默认 null：`AppShell` 单独挂在 Storybook / 单测里（没有 `ShellTabs`）时，退回浏览器
 * 形态那条 `ViewTabStrip`，不会渲染出一个没有 store 支撑的空标题行。
 */
const TitleBarSlotContext = createContext<ReactNode>(null);

export function TitleBarSlotProvider({ children, slot }: { children: ReactNode; slot: ReactNode }) {
  return <TitleBarSlotContext.Provider value={slot}>{children}</TitleBarSlotContext.Provider>;
}

/** 内容列顶部的标题行；没有 Provider 时返回 null。 */
export function useTitleBarSlot(): ReactNode {
  return useContext(TitleBarSlotContext);
}
