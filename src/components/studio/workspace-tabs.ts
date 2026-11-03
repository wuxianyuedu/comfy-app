/**
 * 工作台「视图页签」的状态模型（纯函数，不碰 React、不碰浏览器）。规则收在这里、组件只负责接线 —— 打开/关闭/回落/去重一旦散进组件就没有地方能全判到；此前 workspace 只有一个 `viewMode`，sessionStorage 也只存那一个值，要常驻页签就得升级成「一列页签 + 当前哪一个」。
 * 四条规则（ISSUE #1324 的推荐值，改前先看理由）：页签身份 = (视图, 项目) 二元组（同一「工坊」在两个项目里是两页）；已存在的页签再开一次是**聚焦**、不产生第二页；首页固定不可关，关掉当前页落到**左邻**（不是「最后打开的」，那条规则用户预测不了）；只剩首页时列表仍然成立。
 * 第五条后补（ISSUE #1784）：**瞬时页签**（`NavItem.transient`，如设置/模型适配/模式契约）切换即关。不变式：**最多只有当前页可以是 transient**；任何激活动作（开新页/切页/关页）之后都跑一次 `withTransientPruned` 坐实，于是「切走的那一页还在列表里」在状态层不可能出现，不依赖渲染时序。
 */
import { clamp } from "~/lib/clamp";
import { isProjectTab, isTransientView, type WorkspaceView } from "./NavItems";

/** 首页视图 id —— 固定页签，不可关闭。 */
export const HOME_VIEW: WorkspaceView = "home";

export type ViewTab = {
  /** 页签身份：(视图, 项目) 二元组的稳定编码。 */
  key: string;
  /** 全局视图（首页 / 模型 / 队列…）为 null。 */
  projectId: string | null;
  view: WorkspaceView;
};

export type WorkspaceTabsState = {
  activeKey: string;
  tabs: Array<ViewTab>;
};

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
export function makeTab(view: WorkspaceView, projectId: string | null): ViewTab | null {
  if (isProjectTab(view) && !projectId) {
    return null;
  }
  const bound = isProjectTab(view) ? projectId : null;
  return { key: tabKey(view, bound), view, projectId: bound };
}

export function isTabClosable(tab: ViewTab): boolean {
  return tab.view !== HOME_VIEW;
}

export function findTab(tabs: ReadonlyArray<ViewTab>, key: string): ViewTab | undefined {
  return tabs.find((tab) => tab.key === key);
}

/** 保证首页永远在列表里且在 0 位（关掉最后一个、恢复坏数据都走这一条）。 */
function withHomeFirst(tabs: Array<ViewTab>): Array<ViewTab> {
  const rest = tabs.filter((tab) => tab.view !== HOME_VIEW);
  return [homeTab(), ...rest];
}

/** 这个页签是不是「瞬时页签」（切走即关，见 `NavItem.transient`）。 */
export function isTabTransient(tab: ViewTab): boolean {
  return isTransientView(tab.view);
}

/**
 * 落实「最多只有当前页可以是 transient」：把**非当前页**的瞬时页签剔掉（当前页那份留着 —— 用户正看着它）。抽成函数是为了让四条入口（开/切/关/恢复）共用同一份判据，而不是各自重抄「哪些视图该关」—— 漏一处就会出现永远关不掉的设置页，且没有任何东西会红。
 */
function withTransientPruned(tabs: Array<ViewTab>, activeKey: string): Array<ViewTab> {
  return tabs.filter((tab) => !isTabTransient(tab) || tab.key === activeKey);
}

/**
 * 激活一个页签后的完整状态：先剔瞬时页签，再确认 activeKey 确实指向一页
 * （按理说不会，但防御性地不让 activeKey 指向不存在的页 —— 那是界面上解释不了的空白）。
 */
function activated(tabs: Array<ViewTab>, activeKey: string): WorkspaceTabsState {
  const pruned = withHomeFirst(withTransientPruned(tabs, activeKey));
  const key = findTab(pruned, activeKey) ? activeKey : homeTab().key;
  return { tabs: pruned, activeKey: key };
}

/**
 * 打开/聚焦一个页签。已存在就是聚焦（含「同一视图同一项目」重复点侧栏），不产生第二页；造不出来（项目类视图无活跃项目）时**原样返回**，调用方不会看到半个状态被改。
 */
export function openViewTab(
  state: WorkspaceTabsState,
  view: WorkspaceView,
  projectId: string | null,
): WorkspaceTabsState {
  const tab = makeTab(view, projectId);
  if (!tab) {
    return state;
  }
  if (findTab(state.tabs, tab.key)) {
    // 聚焦已有页：也要走一次剔除 —— 从"设置"切到另一页时,
    // 被切走的那一页正是靠这里退场的（它不会走"新建页"那条分支）。
    return activated(state.tabs, tab.key);
  }
  return activated([...state.tabs, tab], tab.key);
}

/**
 * 切换当前页（页签条上点某一页）。与 `openViewTab` 分开是因为**没有**要开的新页：唯一副作用是「离开的那一页若是瞬时页签就退场」；`find` 判据仍在（点一个不存在的 key 不许把 activeKey 指到空白）。
 */
export function focusViewTab(state: WorkspaceTabsState, key: string): WorkspaceTabsState {
  if (!findTab(state.tabs, key)) {
    return state;
  }
  return activated(state.tabs, key);
}

/**
 * 关闭一个页签。首页不可关；关的不是当前页时当前页不变；关的是当前页时落到**左邻**（按列表位置算，不是按打开时间）。
 */
export function closeViewTab(state: WorkspaceTabsState, key: string): WorkspaceTabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index === -1) {
    return state;
  }
  const target = state.tabs[index];
  if (!target || !isTabClosable(target)) {
    return state;
  }

  const tabs = [...state.tabs.slice(0, index), ...state.tabs.slice(index + 1)];
  if (state.activeKey !== key) {
    return { tabs, activeKey: state.activeKey };
  }
  /* 左邻：删掉本位之后，`index` 上坐的已经是**右邻**了，所以取 `index - 1`。
     与浏览器 / VSCode 关标签页的既有习惯一致（落右边会让用户跳到没预期的地方）。
     夹取走 `~/lib/clamp` 这个唯一出口（§16.2.4.63），不在这里手写 Math.min/max。 */
  const fallbackIndex = clamp(index - 1, 0, tabs.length - 1);
  const fallback = tabs[fallbackIndex] ?? homeTab();
  /* 关掉"设置"这类瞬时页后落到别的页，同样不留下第二个瞬时页 ——
     `activated` 顺带保证落点页存在。 */
  return activated(tabs, fallback.key);
}

/**
 * 项目被删/改名后，属于它的页签必须整批关掉 —— 留一个点开空白的页签比关掉更糟。
 * 若关掉的正是当前页，落点规则与手动关闭一致（左邻）。
 */
export function dropProjectTabs(state: WorkspaceTabsState, projectId: string): WorkspaceTabsState {
  const kept = state.tabs.filter((tab) => tab.projectId === null || tab.projectId !== projectId);
  if (kept.length === state.tabs.length) {
    return state;
  }
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
 * 键里存的是**页签列表**（形状见 `serializeWorkspaceTabs`）。这里只有一个键：
 * 历史上并存过一个只存单个视图的旧键，它早在迁移窗口内就被「读到即删」清掉了，
 * 保留读取分支只会让一份没人再生产的形状继续占着恢复路径（§12.15）。 */

export const WS_TABS_KEY = "comfyapp:workspace-tabs-v2";

export function serializeWorkspaceTabs(state: WorkspaceTabsState): string {
  /* 瞬时页签**不落盘**：它是「读过即走」的配置屏，下次开机不该自己弹回来 —— 落盘与恢复是两条独立的路，不写进去就不存在这个可能。
     当前页恰是瞬时页时把 activeKey 一并改指首页：否则存下来的 activeKey 指向不在列表里的页，`parseWorkspaceTabs` 会按「整份不可信」丢弃全部页签（详见下面的解析口径），用户就会在一次冷启动里丢掉所有常驻页，只为当时正停在设置上。 */
  const persisted = state.tabs.filter((tab) => !isTabTransient(tab));
  const activeStillThere = persisted.some((tab) => tab.key === state.activeKey);
  return JSON.stringify({
    activeKey: activeStillThere ? state.activeKey : tabKey(HOME_VIEW, null),
    tabs: persisted.map((tab) => [tab.view, tab.projectId]),
  });
}

/**
 * 解析存储值。任何一处不合法都**整份放弃**回落到初始状态，而不是半份恢复：
 * 半份恢复会造出"当前页签指向一个不存在的页"这种界面上解释不了的状态。
 */
export function parseWorkspaceTabs(
  raw: string | null,
  knownViews: ReadonlyArray<WorkspaceView>,
): WorkspaceTabsState | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  /* SAFETY: 类型断言已复核 */
  const record = parsed as {
    activeKey?: unknown;
    tabs?: unknown;
  };
  if (!Array.isArray(record.tabs) || typeof record.activeKey !== "string") {
    return null;
  }
  const tabs: Array<ViewTab> = [];
  for (const entry of record.tabs) {
    if (!Array.isArray(entry) || entry.length < 2) {
      return null;
    }
    /* SAFETY: 类型断言已复核 */
    const [view, projectId] = entry as [unknown, unknown];
    if (
      typeof view !== "string" ||
      /* SAFETY: 类型断言已复核 */
      !knownViews.includes(view as WorkspaceView)
    ) {
      return null;
    }
    if (projectId !== null && typeof projectId !== "string") {
      return null;
    }
    /* SAFETY: 类型断言已复核 */
    const tab = makeTab(view as WorkspaceView, projectId);
    // 造不出来（项目类视图丢了项目 id）或键重复 ⇒ 整份不可信。
    if (!tab || tabs.some((existing) => existing.key === tab.key)) {
      return null;
    }
    tabs.push(tab);
  }
  const normalized = withHomeFirst(tabs);
  if (!normalized.some((tab) => tab.key === record.activeKey)) {
    return null;
  }
  return { tabs: normalized, activeKey: record.activeKey };
}
