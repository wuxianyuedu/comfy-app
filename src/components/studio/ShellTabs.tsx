"use client";

/* ── ShellTabs · 桌面壳的窗口外壳（标题行插槽 + 顶层容器）────────────
 * 在 Tauri 主窗口里承载「主应用」与「内嵌的 ComfyUI」同一窗口的壳层边界，
 * 替代此前会弹出空白独立窗口的 `open_comfyui_window`（ISSUE #310 / #200）。
 * 标题行（拖拽区 + 窗口按钮，判据 `shouldUseTitleBarTabs`）经
 * `TitleBarSlotProvider` 交给 `AppShell` 落在内容列顶部（ISSUE #3807）；
 * 浏览器 / dev 无标题行。
 *
 * **主应用与 iframe 页签的显隐不在这层判**（ISSUE #4898 的教训）：此前本组件
 * 在 iframe 页签激活时把 `children`（整棵 `AppShell`，含侧栏与窗口按钮）整体
 * `hidden`，而页签切换器（侧栏「临时页签」组）就住在里面 —— 用户被困在
 * ComfyUI 里切不回来。现在主应用内容与 iframe 页签内容的同列切换由
 * `AppShell` 的内容列承接（iframe 内容渲染在 `ShellTabContent`），侧栏常驻
 * 可见，切换器永远在场。
 */

import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";
import { TitleBarSlotProvider } from "./TitleBarSlot";
import { TitleBar } from "./TitleBar";

type ShellTabsProps = {
  /** 主应用页签的内容（即 workspace 整套界面，含侧栏外壳 `AppShell`）。 */
  children: React.ReactNode;
};

export function ShellTabs({ children }: ShellTabsProps) {
  /* 壳探测（SSR 恒 false，客户端再取真值）—— 判据与 `AppShell` 共用一处，
     否则会出现「壳里两条栏、浏览器里零条栏」这种各自自洽的错。 */
  const useTitleBar = useTitleBarTabsActive();

  /* ISSUE #3807：标题行在这里**组装**、在 `AppShell` 的内容列顶部**落位**。
     整窗第一行会把侧栏一起推下 36px，那正是「壳里首页不贴顶」的根因；
     放内容列里则与浏览器态同位，折叠侧栏时左边缘也自动跟着收窄。
     页签已退役（ISSUE #4770）：标题行只剩拖拽区与窗口按钮。 */
  const titleBarSlot = useTitleBar ? <TitleBar /> : null;

  return (
    <TitleBarSlotProvider slot={titleBarSlot}>
      <div className="bg-canvas text-ink flex h-screen w-screen flex-col overflow-hidden">
        {/* 内容区：children（含侧栏外壳）恒挂载、恒可见；iframe 页签内容在
            `AppShell` 内容列里与之同列显隐（见文件头说明）。底部间距只给主应用
            （pb-6 在 AppShell 的主内容包装层）：全局底部状态栏（根布局挂载的
            24px 固定悬浮层）盖住窗口最底下一条；ComfyUI iframe 则拿满内容列
            全部高度 —— 它与浏览器整窗打开时一样要容纳自绘的底部控件（运行
            操作栏、扩展面板），少一截就出现「浏览器里看得见、应用里被裁掉」。 */}
        <div className="relative min-h-0 flex-1">{children}</div>
      </div>
    </TitleBarSlotProvider>
  );
}
