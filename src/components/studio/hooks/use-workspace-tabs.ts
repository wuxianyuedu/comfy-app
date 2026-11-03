"use client";

// ── 工作台视图页签的逻辑层（规范 17 §17.2 第②层）────────────────────────
// 页签状态、sessionStorage 恢复/落盘、打开/选中/关闭三个动作收在这里。
//
// 判据要的是**按职责拆**，不是在一个函数里加注释分段 —— 组件里只留接线，
// 页签规则的单测仍然只在 `workspace-tabs.ts` 那一层（这里只做装配，
// 不重复实现规则）。

import { useCallback, useEffect, useState } from "react";

import {
  WS_TABS_KEY,
  HOME_VIEW,
  closeViewTab,
  findTab,
  focusViewTab,
  initialWorkspaceTabs,
  openViewTab,
  parseWorkspaceTabs,
  serializeWorkspaceTabs,
  type WorkspaceTabsState,
} from "../workspace-tabs";
import type { WorkspaceView } from "../NavItems";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";

/** 合法视图白名单：持久化恢复与「请求切视图」的应用事件都按它收敛。 */
export const WORKSPACE_VIEWS: Array<WorkspaceView> = [
  "home",
  "project",
  "canvas",
  "models",
  "works",
  "workshop",
  "library",
  "history",
  "queue",
  "film",
  "workflows",
  "outputs",
  "console",
  "settings",
  /* 这两个此前不是视图（侧栏「全局浮层入口」点开弹窗），所以不在白名单里。
     改成视图页签后必须登记：漏一个的后果不是报错，而是**这一页开不了也恢复不了**
     —— `navigateTo` 与 sessionStorage 恢复都按这份白名单收敛未知 id。 */
  "model-adapters",
  "mode-contract",
];

function readTabsState(): WorkspaceTabsState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = sessionStorage.getItem(WS_TABS_KEY);
  if (raw === null || raw === "") {
    return null;
  }
  return parseWorkspaceTabs(raw, WORKSPACE_VIEWS);
}

function writeTabsState(state: WorkspaceTabsState): void {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.setItem(WS_TABS_KEY, serializeWorkspaceTabs(state));
}

export type WorkspaceTabsController = {
  /** 当前页签 key。 */
  activeKey: string;
  /** 页签条上点关闭。 */
  closeTab: (key: string) => void;
  /** 打开/聚焦一个视图页签（侧栏、首页入口、应用事件都走这里）。 */
  navigateTo: (view: WorkspaceView) => void;
  /** 页签条上点某一页。 */
  selectTab: (key: string) => void;
  /** 页签列表（渲染页签条用）。 */
  tabs: WorkspaceTabsState["tabs"];
  /** 当前视图 —— 组件里那一大段 `switch (viewMode)` 的判据来源。 */
  viewMode: WorkspaceView;
};

export function useWorkspaceTabs(): WorkspaceTabsController {
  const [tabsState, setTabsState] = useState<WorkspaceTabsState>(initialWorkspaceTabs);
  const activateShellTab = useShellTabs((s) => s.activateTab);

  /* ── 恢复：把上次离开时的页签从 sessionStorage 播回来 ─────────────────────
   *
   * 不能放进 `useState` 初始值：SSR 阶段读不到 `sessionStorage`，而 hydration
   * **不会重跑** initializer，恢复就永远不生效。所以恢复走挂载后的 effect。
   *
   * ⚠️ 「恢复跑过没有」这一个布尔量**拦不住**落盘 —— 两个 effect 跑在同一个
   * commit 里，恢复只是 `setTabsState()`（下一轮渲染才生效），而落盘拿到的仍是
   * 这一轮的初始态（只有首页一页），于是把存储里的页签冲掉。现场就是
   * ISSUE #1501 / #1727：刷新后 active-id 还在、页签却没了，用户被踢回首页。
   *
   * 正确的判据是「**这一轮要落盘的 state 是不是已与存储对过账**」：`hydrated`
   * 作为**状态**（不是 ref）承载这件事 —— 它在恢复落地的那一轮渲染里才为真，
   * 于是落盘天然只发生在对账之后。 */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const restored = readTabsState();
    if (restored) {
      // 跳过 hydration 窗口后恢复，避免对 SSR 渲染树造成级联 setState。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTabsState(restored);
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    /* 对账完成前一律不落盘（机制见上）：否则挂载这一轮会先把初始态（只有首页
       一页）写进 sessionStorage，把用户存好的列表冲掉，随后才读到空。 */
    if (!hydrated) {
      return;
    }
    writeTabsState(tabsState);
  }, [tabsState, hydrated]);

  /* 当前视图 id —— 判据只认「视图」，同一视图的两个项目页签算同一屏。
   * 「界面打开」的日志（含耗时）不在这里写：它要等这一屏**内容真的挂载**才算
   * 数，落在 `WorkspaceViewStack` + `ViewOpenReport`（见那两处的说明）。 */
  const viewMode: WorkspaceView = findTab(tabsState.tabs, tabsState.activeKey)?.view ?? HOME_VIEW;

  const navigateTo = useCallback((view: WorkspaceView) => {
    /* 绑的是 store 的同步读数，不是组件里那个 `activeProjectId` React 状态：
       「打开项目」的 handler 里 setActive(id) 与 navigateTo 是同一次事件先后调用的，
       读状态会拿到旧值 ⇒ 项目页签被开成"无项目"或直接丢绑。 */
    const projectId = getActiveId();
    setTabsState((prev) => openViewTab(prev, view, projectId));
  }, []);

  const selectTab = useCallback(
    (key: string) => {
      // 切页的规则（含「切走的若是瞬时页则退场」）都在 `focusViewTab`，
      // 这里不自己判：找不到这一页时它原样返回，不会把当前页指向空白。
      setTabsState((prev) => focusViewTab(prev, key));
      /* 用户可能正停在 ComfyUI 那个 iframe 页签上：只改视图页签而不动壳的激活页，
         表现就是「点了没反应」。 */
      activateShellTab(MAIN_TAB_ID);
    },
    [activateShellTab],
  );

  const closeTab = useCallback((key: string) => {
    // 回落与可关性都由 closeViewTab 那条规则决定，视图/装配层不自己判。
    setTabsState((prev) => closeViewTab(prev, key));
  }, []);

  return {
    tabs: tabsState.tabs,
    activeKey: tabsState.activeKey,
    viewMode,
    navigateTo,
    selectTab,
    closeTab,
  };
}
