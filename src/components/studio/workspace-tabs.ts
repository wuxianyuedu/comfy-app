/**
 * 工作台「视图页签」的状态模型（纯函数，不碰 React、不碰浏览器）。
 *
 * 为什么要单独一份：workspace 此前只有一个 `viewMode`，sessionStorage 里也只存
 * 那一个值。要做常驻页签，状态就得升级成「一列页签 + 当前哪一个」；而打开/关闭/
 * 回落/去重这些规则一旦散进组件，就没有任何地方能把它全部判到。这里承载规则，
 * 组件只负责接线。
 *
 * 四条规则是拍过板的（ISSUE #1324 的推荐值），改动前先去看那里的理由：
 *   · 页签身份 = (视图, 项目) 二元组 —— 同一个「工坊」在两个项目里是两页；
 *   · 已存在的页签再开一次是**聚焦**，不产生第二页；
 *   · 首页固定不可关，关掉当前页落到**左邻**（不是"最后打开的"，那条规则用户预测不了）；
 *   · 只剩首页时列表仍然成立（不塌成"没有页签"的另一种布局）。
 */
import { clamp } from "~/lib/clamp";
import { isProjectTab, type WorkspaceView } from "./NavItems";

/** 首页视图 id —— 固定页签，不可关闭。 */
export const HOME_VIEW: WorkspaceView = "home";

export interface ViewTab {
  /** 页签身份：(视图, 项目) 二元组的稳定编码。 */
  key: string;
  view: WorkspaceView;
  /** 全局视图（首页 / 模型 / 队列…）为 null。 */
  projectId: string | null;
}

export interface WorkspaceTabsState {
  tabs: ViewTab[];
  activeKey: string;
}

/** 页签身份的唯一编码处 —— 别在调用点各拼一遍分隔符。 */
export function tabKey(view: WorkspaceView, projectId: string | null): string {
  return `${view}:${projectId ?? ""}`;
}

export function homeTab(): ViewTab {
  return { key: tabKey(HOME_VIEW, null), view: HOME_VIEW, projectId: null };
}

/**
 * 造一个页签。项目类视图**必须带项目 id**：没有活跃项目时它是开不出来的
 * （与 workspace 现有的 `isProjectTab(viewMode) && !activeProjectId` 守卫同源，
 * 收在一处意味着两处不会一处放行一处白屏）。
 */
export function makeTab(
  view: WorkspaceView,
  projectId: string | null,
): ViewTab | null {
  if (isProjectTab(view) && !projectId) return null;
  const bound = isProjectTab(view) ? projectId : null;
  return { key: tabKey(view, bound), view, projectId: bound };
}

export function isTabClosable(tab: ViewTab): boolean {
  return tab.view !== HOME_VIEW;
}

export function findTab(
  tabs: readonly ViewTab[],
  key: string,
): ViewTab | undefined {
  return tabs.find((tab) => tab.key === key);
}

/** 保证首页永远在列表里且在 0 位（关掉最后一个、恢复坏数据都走这一条）。 */
function withHomeFirst(tabs: ViewTab[]): ViewTab[] {
  const rest = tabs.filter((tab) => tab.view !== HOME_VIEW);
  return [homeTab(), ...rest];
}

/**
 * 打开/聚焦一个页签。
 *
 * 已存在就是聚焦（含"同一视图同一项目"重复点侧栏），不产生第二页；
 * 造不出来（项目类视图无活跃项目）时**原样返回**，调用方不会看到半个状态被改。
 */
export function openViewTab(
  state: WorkspaceTabsState,
  view: WorkspaceView,
  projectId: string | null,
): WorkspaceTabsState {
  const tab = makeTab(view, projectId);
  if (!tab) return state;
  if (findTab(state.tabs, tab.key)) {
    return { tabs: state.tabs, activeKey: tab.key };
  }
  return { tabs: [...state.tabs, tab], activeKey: tab.key };
}

/**
 * 关闭一个页签。
 *
 * 首页不可关；关的不是当前页时当前页不变；关的是当前页时落到**左邻**
 * （左邻按列表位置算，不是按打开时间）。
 */
export function closeViewTab(
  state: WorkspaceTabsState,
  key: string,
): WorkspaceTabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index < 0) return state;
  const target = state.tabs[index];
  if (!target || !isTabClosable(target)) return state;

  const tabs = [...state.tabs.slice(0, index), ...state.tabs.slice(index + 1)];
  if (state.activeKey !== key) {
    return { tabs, activeKey: state.activeKey };
  }
  /* 左邻：删掉本位之后，`index` 上坐的已经是**右邻**了，所以取 `index - 1`。
     与浏览器 / VSCode 关标签页的既有习惯一致（落右边会让用户跳到没预期的地方）。
     夹取走 `~/lib/clamp` 这个唯一出口（§16.2.4.63），不在这里手写 Math.min/max。 */
  const fallbackIndex = clamp(index - 1, 0, tabs.length - 1);
  const fallback = tabs[fallbackIndex] ?? homeTab();
  return { tabs, activeKey: fallback.key };
}

/**
 * 项目被删/改名后，属于它的页签必须整批关掉 —— 留一个点开空白的页签比关掉更糟。
 * 若关掉的正是当前页，落点规则与手动关闭一致（左邻）。
 */
export function dropProjectTabs(
  state: WorkspaceTabsState,
  projectId: string,
): WorkspaceTabsState {
  const kept = state.tabs.filter(
    (tab) => tab.projectId === null || tab.projectId !== projectId,
  );
  if (kept.length === state.tabs.length) return state;
  const activeStillThere = kept.some((tab) => tab.key === state.activeKey);
  return {
    tabs: withHomeFirst(kept),
    activeKey: activeStillThere ? state.activeKey : tabKey(HOME_VIEW, null),
  };
}

/** 初始状态：只有首页一页。 */
export function initialWorkspaceTabs(): WorkspaceTabsState {
  return { tabs: [homeTab()], activeKey: homeTab().key };
}

/* ── 持久化（sessionStorage 的唯一一份视图状态）─────────────────────────
 *
 * 旧键 `comfyapp:workspace-view-v1` 存的是**单个视图**。这里换成 v2 的列表，
 * 并在读到时**一次性迁移 + 删掉旧键** —— 不留两个名字指同一件事（§12.14），
 * 也不允许出现"两个键各存一半、恢复时看谁先到"的状态。 */

export const WS_TABS_KEY = "comfyapp:workspace-tabs-v2";
/** 旧单值键；只用于一次性迁移，读到即删。 */
export const LEGACY_WS_VIEW_KEY = "comfyapp:workspace-view-v1";

export function serializeWorkspaceTabs(state: WorkspaceTabsState): string {
  return JSON.stringify({
    activeKey: state.activeKey,
    tabs: state.tabs.map((tab) => [tab.view, tab.projectId]),
  });
}

/**
 * 解析存储值。任何一处不合法都**整份放弃**回落到初始状态，而不是半份恢复：
 * 半份恢复会造出"当前页签指向一个不存在的页"这种界面上解释不了的状态。
 */
export function parseWorkspaceTabs(
  raw: string | null,
  knownViews: readonly WorkspaceView[],
): WorkspaceTabsState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { activeKey?: unknown; tabs?: unknown };
  if (!Array.isArray(record.tabs) || typeof record.activeKey !== "string") {
    return null;
  }
  const tabs: ViewTab[] = [];
  for (const entry of record.tabs) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const [view, projectId] = entry as [unknown, unknown];
    if (typeof view !== "string" || !knownViews.includes(view as WorkspaceView))
      return null;
    if (projectId !== null && typeof projectId !== "string") return null;
    const tab = makeTab(view as WorkspaceView, projectId);
    // 造不出来（项目类视图丢了项目 id）或键重复 ⇒ 整份不可信。
    if (!tab || tabs.some((existing) => existing.key === tab.key)) return null;
    tabs.push(tab);
  }
  const normalized = withHomeFirst(tabs);
  if (!normalized.some((tab) => tab.key === record.activeKey)) return null;
  return { tabs: normalized, activeKey: record.activeKey };
}
