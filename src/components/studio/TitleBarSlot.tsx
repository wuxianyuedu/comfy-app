"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 桌面壳标题行的插槽（ISSUE #3807）。
 *
 * `TitleBar`（拖拽区 + 窗口按钮，ISSUE #4770 起不再携带页签）要渲染在 `AppShell`
 * 的**内容列顶部**，而不是整窗第一行 —— 否则那条 36px 横条会把侧栏与内容一起
 * 推下去。与其把壳的状态一路透传进 `AppShell`，这里让 `ShellTabs` 把已经组装好
 * 的标题行作为 ReactNode 交给下游，由 `AppShell` 决定放哪儿。
 *
 * 默认 null：`AppShell` 单独挂在 Storybook / 单测里（没有 `ShellTabs`）时，
 * 不渲染没有 store 支撑的空标题行。
 */
const TitleBarSlotContext = createContext<ReactNode>(null);

export function TitleBarSlotProvider({ children, slot }: { children: ReactNode; slot: ReactNode }) {
  return <TitleBarSlotContext.Provider value={slot}>{children}</TitleBarSlotContext.Provider>;
}

/** 内容列顶部的标题行；没有 Provider 时返回 null。 */
export function useTitleBarSlot(): ReactNode {
  return useContext(TitleBarSlotContext);
}
