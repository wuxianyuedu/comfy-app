"use client";

// ── 工作台视图页签的逻辑层（规范 17 §17.2 第②层）────────────────────────
// 页签状态、sessionStorage 恢复/落盘、打开/选中/关闭三个动作收在这里。
//
// 判据要的是**按职责拆**，不是在一个函数里加注释分段 —— 组件里只留接线，
// 页签规则的单测仍然只在 `workspace-tabs.ts` 那一层（这里只做装配，
// 不重复实现规则）。

import { useCallback, useEffect, useRef, useState } from "react";

import {
  WS_TABS_KEY,
  HOME_VIEW,
  closeViewTab,
  findTab,
  initialWorkspaceTabs,
  openViewTab,
  parseWorkspaceTabs,
  serializeWorkspaceTabs,
  type WorkspaceTabsState,
} from "../workspace-tabs";
import { type WorkspaceView } from "../NavItems";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";

/** 合法视图白名单：持久化恢复与「请求切视图」的应用事件都按它收敛。 */
export const WORKSPACE_VIEWS: WorkspaceView[] = [
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
];

function readTabsState(): WorkspaceTabsState | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(WS_TABS_KEY);
  if (!raw) return null;
  return parseWorkspaceTabs(raw, WORKSPACE_VIEWS);
}

function writeTabsState(state: WorkspaceTabsState): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(WS_TABS_KEY, serializeWorkspaceTabs(state));
}

export interface WorkspaceTabsController {
  /** 页签列表（渲染页签条用）。 */
  tabs: WorkspaceTabsState["tabs"];
  /** 当前页签 key。 */
  activeKey: string;
  /** 当前视图 —— 组件里那一大段 `switch (viewMode)` 的判据来源。 */
  viewMode: WorkspaceView;
  /** 打开/聚焦一个视图页签（侧栏、首页入口、应用事件都走这里）。 */
  navigateTo: (view: WorkspaceView) => void;
  /** 页签条上点某一页。 */
  selectTab: (key: string) => void;
  /** 页签条上点关闭。 */
  closeTab: (key: string) => void;
}

export function useWorkspaceTabs(): WorkspaceTabsController {
  const [tabsState, setTabsState] =
    useState<WorkspaceTabsState>(initialWorkspaceTabs);
  const activateShellTab = useShellTabs((s) => s.activateTab);

  /* 恢复上次离开时的页签。不能放进 useState 初始值 —— SSR 阶段读不到
     sessionStorage，而 hydration 不会重跑 initializer，恢复就永远不生效。 */
  const hydratedRef = useRef(false);
  useEffect(() => {
    const restored = readTabsState();
    // 无论恢复成不成功，从这一步起才允许落盘。
    hydratedRef.current = true;
    if (restored) {
      // 跳过 hydration 窗口后恢复，避免对 SSR 渲染树造成级联 setState。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTabsState(restored);
    }
  }, []);
  useEffect(() => {
    /* 恢复那一步之前**不落盘**：否则挂载这一轮会先把初始态（只有首页一页）写进
       sessionStorage，把用户存好的列表冲掉，随后才读到空。 */
    if (!hydratedRef.current) return;
    writeTabsState(tabsState);
  }, [tabsState]);

  const navigateTo = useCallback((view: WorkspaceView) => {
    /* 绑的是 store 的同步读数，不是组件里那个 `activeProjectId` React 状态：
       「打开项目」的 handler 里 setActive(id) 与 navigateTo 是同一次事件先后调用的，
       读状态会拿到旧值 ⇒ 项目页签被开成"无项目"或直接丢绑。 */
    const projectId = getActiveId();
    setTabsState((prev) => openViewTab(prev, view, projectId));
  }, []);

  const selectTab = useCallback(
    (key: string) => {
      setTabsState((prev) =>
        // 找不到这一页时原样返回：把当前页指向不存在的页，界面上是一句解释不了的空白。
        findTab(prev.tabs, key) ? { ...prev, activeKey: key } : prev,
      );
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
    viewMode: findTab(tabsState.tabs, tabsState.activeKey)?.view ?? HOME_VIEW,
    navigateTo,
    selectTab,
    closeTab,
  };
}
