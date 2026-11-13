"use client";

// ── 工作台视图页签的逻辑层（规范 17 §17.2 第②层）
// 页签状态、sessionStorage 恢复/落盘、打开/选中/关闭三个动作收在这里。
// 按职责拆而非加注释分段：组件只留接线，页签规则的单测仍在 `workspace-tabs.ts` 那一层。

import { useCallback, useEffect, useMemo, useState } from "react";

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
import {
  defaultSidebarTabConfig,
  makeTransientJudge,
  type TransientJudge,
  type WorkspaceView,
} from "../NavItems";
import type { SidebarTabConfig } from "~/lib/shell/sidebar-tab-behavior";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";
import { useSidebarTabConfigQuery } from "./use-sidebar-tab-config";

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
  "uiKit",
  /* 这两个此前不是视图（侧栏「全局浮层入口」点开弹窗），所以不在白名单里。
     改成视图页签后必须登记：漏一个的后果不是报错，而是**这一页开不了也恢复不了**
     —— `navigateTo` 与 sessionStorage 恢复都按这份白名单收敛未知 id。 */
  "model-adapters",
  "model-test",
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

function writeTabsState(state: WorkspaceTabsState, isTransient: TransientJudge): void {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.setItem(WS_TABS_KEY, serializeWorkspaceTabs(state, isTransient));
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

  /* 侧栏项的页签行为（ISSUE #3623）：「这一项切走时关不关」由配置面决定。
   * 服务端那份还没取回时用**项目默认**（编译进产物的那份）—— 于是「配置还没到」
   * 与「配置就是默认」在界面上是同一件事，那正是它们该有的样子。
   * 兜底那份**只算一次**：它每次调用都是一份新对象，而判据是按引用 memo 的
   * （判据一变，下面三个动作的 useCallback 全要重造）。 */
  const configQuery = useSidebarTabConfigQuery();
  const fallbackConfig = useMemo(() => defaultSidebarTabConfig(), []);
  const config: SidebarTabConfig = configQuery.data?.config ?? fallbackConfig;
  const isTransient = useMemo(() => makeTransientJudge(config), [config]);

  /* ── 恢复：把上次离开时的页签从 sessionStorage 播回来 ──
   * 不能放进 `useState` 初始值：SSR 读不到 sessionStorage、hydration 不重跑 initializer，恢复永远不生效。
   * 「恢复跑过没有」布尔量**拦不住**落盘：两个 effect 同 commit，恢复只是 setTabsState（下一轮才生效），
   * 落盘拿到仍是只有首页的初始态、把存储冲掉（ISSUE #1501 / #1727）。正确判据：`hydrated` 状态（非 ref）已对过账。 */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const restored = readTabsState();
    if (restored) {
      // 跳过 hydration 窗口后恢复，避免对 SSR 渲染树造成级联 setState。
      // oxlint-disable-next-line react/set-state-in-effect
      setTabsState(restored);
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    /* 对账完成前一律不落盘（机制见上）：否则挂载这一轮会先把初始态（只有首页
       一页）写进 sessionStorage，把用户存好的列表冲掉，随后才读到空。
       落盘**不等**配置面取回（ISSUE #3657）：页签的存与取都在客户端
       （sessionStorage），等一趟服务端往返才落盘，等于把「刷新后仍在」这条
       客户端不变式押在服务端可用性上 —— 配置接口一旦没答上来（GA 每日档的
       e2e 桩、或任何后端故障），页签就再也不落盘，新建项目刷新后回到首页。
       判据未取回时本就回落项目默认，落盘形状与界面所见一致；配置取回后判据
       变化，这里的依赖会把最新判据下的状态重写一遍。 */
    if (!hydrated) {
      return;
    }
    writeTabsState(tabsState, isTransient);
  }, [tabsState, hydrated, isTransient]);

  /* 当前视图 id —— 判据只认「视图」，同一视图的两个项目页签算同一屏。
   * 「界面打开」的日志（含耗时）不在这里写：它要等这一屏**内容真的挂载**才算
   * 数，落在 `WorkspaceViewStack` + `ViewOpenReport`（见那两处的说明）。 */
  const viewMode: WorkspaceView = findTab(tabsState.tabs, tabsState.activeKey)?.view ?? HOME_VIEW;

  const navigateTo = useCallback(
    (view: WorkspaceView) => {
      /* 绑的是 store 的同步读数，不是组件里那个 `activeProjectId` React 状态：
         「打开项目」的 handler 里 setActive(id) 与 navigateTo 是同一次事件先后调用的，
         读状态会拿到旧值 ⇒ 项目页签被开成"无项目"或直接丢绑。 */
      const projectId = getActiveId();
      setTabsState((prev) => openViewTab(prev, view, projectId, isTransient));
    },
    [isTransient],
  );

  const selectTab = useCallback(
    (key: string) => {
      // 切页的规则（含「切走的若是瞬时页则退场」）都在 `focusViewTab`，
      // 这里不自己判：找不到这一页时它原样返回，不会把当前页指向空白。
      setTabsState((prev) => focusViewTab(prev, key, isTransient));
      /* 用户可能正停在 ComfyUI 那个 iframe 页签上：只改视图页签而不动壳的激活页，
         表现就是「点了没反应」。 */
      activateShellTab(MAIN_TAB_ID);
    },
    [activateShellTab, isTransient],
  );

  const closeTab = useCallback(
    (key: string) => {
      // 回落与可关性都由 closeViewTab 那条规则决定，视图/装配层不自己判。
      setTabsState((prev) => closeViewTab(prev, key, isTransient));
    },
    [isTransient],
  );

  return {
    tabs: tabsState.tabs,
    activeKey: tabsState.activeKey,
    viewMode,
    navigateTo,
    selectTab,
    closeTab,
  };
}
