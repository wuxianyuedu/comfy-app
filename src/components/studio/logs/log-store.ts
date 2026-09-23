"use client";

/**
 * log-store — 日志面板全局状态单例（Zustand）。
 *
 * 规范 07 §7.4：日志状态用 Zustand 管理，不使用 React Context。
 * 多个面板（BrowserStatusBar / LogPanel）直接读取同一 store。
 *
 * ── 时间线契约（面板「按时间顺序 + 有信息量」的地基）──────────────────
 * 时间线是**合并后的单一顺序**，不是「按到达顺序堆叠」：
 *   1. 排序键是 `(time, seq)`——`time` 是每行自带的写入时刻（毫秒），
 *      `seq` 只是同一毫秒内的稳定次键（跨来源去重后按它保持确定性顺序）。
 *      此前按到达顺序堆叠，三路轮询（launcher / dev / app-runtime）并发回来时
 *      旧时刻的行会落在新时刻的行之后，面板看着像「停在原地」（ISSUE #346）。
 *   2. 同一行被多路读到（launcher 转写含 dev 输出、文件被整段重读）时按
 *      `time + level + message` 去重，不重复计入。没有这条，面板的条数与
 *      真实事件数对不上，翻页也会翻出重复内容。
 *   3. 读不到时刻的裸文本行由解析层钳到当时本地时刻，因此**不会**落到历史行
 *      之前（旧的「按解析时刻 + 只追加」写法会把它们排到末尾，破坏时间序）。
 */

import { countAfterPage, tailPages, tailWindow } from "~/lib/page-window";

import { create } from "zustand";

import { saveLogExport, type SavedLogExport } from "~/lib/log/log-file-client";

import { copyLogText, downloadLogText } from "./log-export";
import { formatForClipboard } from "./log-format";
import { disabledCategories, useLogCategoryStore } from "./log-category-store";

/* 格式化口径落在 log-format（视图与 store 共用一份）；这里按原路径转出，
 * 既有导入（测试、面板）逐字不变。 */
export {
  formatEntryForClipboard,
  formatForClipboard,
  formatTime,
} from "./log-format";
/* 类型与共享叶子（`log-types`）+ 采集 / 解析 / 过滤纯函数（`log-analysis`）
 * 都从这里进入；主文件只留 store state / actions / selector。类型与函数
 * 通过底部 `export * from` 一并 re-export，消费者
 * `from "~/components/studio/logs/log-store"` 的路径**完全不变**。 */
import {
  LOG_PAGE_SIZE,
  type LogEntry,
  type LogFilter,
  type LogLevelCounts,
  type LogOriginCounts,
  type LogOriginFilter,
} from "./log-types";
import {
  computeCounts,
  computeFiltered,
  computeOriginCounts,
  dropStaleEntries,
  mergeTimeline,
  nextId,
  nextSeq,
} from "./log-analysis";

export * from "./log-types";
export * from "./log-analysis";

function welcomeEntry(): LogEntry {
  return {
    id: nextId(),
    seq: nextSeq(),
    time: Date.now(),
    level: "info",
    message: "日志面板已启用。按 Ctrl+Shift+L 或点击状态栏日志按钮打开/关闭。",
    source: "system",
  };
}

export interface LogStoreState {
  logs: LogEntry[];
  filteredLogs: LogEntry[];
  filter: LogFilter;
  /** 来源筛选（#262：启动日志与应用运行日志混在一屏，需要能分开看）。 */
  origin: LogOriginFilter;
  search: string;
  isOpen: boolean;
  counts: LogLevelCounts;
  /**
   * 每个来源各自的级别计数（含 `all` 汇总）：面板在级别按钮与来源下拉上各显示
   * 一份，用户不必先切来源才知道那边有几个警告（见 computeOriginCounts）。
   */
  countsByOrigin: LogOriginCounts;
  /**
   * 面板渲染一帧所需的全部状态（见 {@link LogPanelSlice}）。
   *
   * 它随时间线或筛选状态变化而整体重建，面板只订阅这一个字段。视图层因此不必
   * 自己拼装状态、也就不会出现「某条写入路径忘了带视图状态」的漏项——那正是
   * 「来源切了、计数还停在切之前」这类 bug 的来源。
   */
  header: LogPanelSlice;
  /** 翻页：当前页（1 起，倒序查看，1 = 最新一页）与每页条数。 */
  page: number;
  pageSize: number;
  /**
   * 本次运行的开始时间（毫秒）；null = 未知（非 launcher 启动）。
   * 面板只显示本次运行：行时刻早于它即上一次运行的残留（见 dropStaleEntries）。
   */
  sessionStart: number | null;
  /**
   * 当前提供日志的服务端进程标识（bootId）。
   *
   * 它回答的是「这条日志是哪个应用服务进程写的」：进程重启（或另一实例接管
   * 端口）后 bootId 变化，面板据此**清空时间线并重读**，而不是把两个进程的
   * 输出混成一条线。面板页脚展示它，用户报障时能说清自己连的是哪个进程
   * （ISSUE #360：「应用服务为什么没启动」现场没有任何可引用的标识）。
   */
  bootId: string | null;
  /**
   * 生成 `logs` 切片的生成号（每次时间线变化 +1）。
   *
   * 它是「store 有没有新日志」的判据，而不是时间线末条 seq：时间线按时刻排序，
   * 一条**迟到但时刻更早**的行会插进中间、末条不变——只看末条会漏掉这种新增。
   */
  revision: number;
  /**
   * 「已翻过去的历史」：翻到这一页那一刻，窗口之后本来就有多少条。
   *
   * 页脚「有 N 条新的日志」= 窗口之后的条数 − 它（见 selectNewLogCount）——
   * 否则停在第 2 页会一开口就报「有 200 条新的日志」，而那 200 条是用户自己
   * 翻过去的。第 1 页恒为 0。
   */
  viewBaselineAfter: number;
  /**
   * 「已读水位」：翻到历史位置那一刻**已经看到**的条目。
   *
   * 它是投影计数（`selectNewLogCount`）的输入，回答「我看到的之后又来了几条」。
   * 同时也决定贴底时滚动到哪里（见 LogPanel 的贴底基线）——两者用同一份水位，
   * 所以「面板说有几条新的」与「实际滚到哪」永远不会各说各话。
   */
  viewSeenIds: ReadonlySet<string>;
  /**
   * 「贴底基线」：面板开着且用户贴着底看时，**只追到这里**。
   *
   * 它是「日志一直在动、选不中想复制的那一行」的根治点（ISSUE #262 复审）：
   * 面板此前用「内容一变就滚到 `scrollHeight`」贴底，而日志每 2s 轮询一次、
   * 上限 2000 条时几乎每轮都有新行——于是内容每两秒整体上移一次，用户刚框住的
   * 文本立刻被滚动冲掉。现在贴底只追到「面板开着那一刻已看过的最后一条」，
   * 新行在下面**默默累积**（页脚同时给出「有 N 条新的日志 · 回到最新」出口），
   * 看不看、什么时候看由用户决定。
   *
   * 它与「已读水位」（`viewSeenIds`）是同一份东西的两种用途：水位决定**滚到哪**
   * 与**报几条新的**，因此两处永远不会互相矛盾。
   */
  followBaseline: number;
  /**
   * 用户主动按下「回到最新」的时刻；此后贴底直接追到最新，不再受
   * {@link followBaseline} 约束。
   */
  followResetAt: number;
  /**
   * 「已读水位」的生成号：翻到历史页那一刻的 `revision`。
   *
   * 判据是 `revision` 变化（时间线真的变过）而不是「末条变了」：按时刻排序后，
   * 一条**迟到的旧时刻行**会插进中间、末条不动——只看末条会漏掉这类新增
   * （ISSUE #346）。
   *
   * ⚠️ `revision` 只在**新行落板**时推进（见 appendFileLogs）：环形缓冲截断
   * 不算落板——2000 条上限的时代它是把旧行挤出去、没有新内容，推进它会把下面
   * 这条推论的循环打断——「revision 变过 → 有新内容 → 重新取水位」，那会让面板
   * 把**每两秒一次的新日志**都当成用户已经读过（水位被反复刷到最新），页脚于是
   * 永远报不出「有 N 条新的日志」（ISSUE #262 复审：翻页翻不动、提示不出现）。
   * 现行时间线无上限、没有截断形态，这条原则保留为「恢复上限时必须沿用」的约定。
   */
  viewRevision: number;
  /**
   * 第 1 页窗口的**锚点**：用户「正在看的那一段」的头一条 id（null = 不锚定）。
   *
   * 为什么需要它：第 1 页取的是时间线的**尾部 200 条**。日志每 2s 轮询一次，
   * 每来一条新行，这 200 条的窗口就整体前移一格——React 会卸载掉最上面那一条、
   * 挂上新的最末一条。用户刚在顶部某一行里框住的文本**随节点一起被卸载**，选区
   * 于是消失（ISSUE #262 复审：「刚选择就刷新把我的选择弄没了」，在真实浏览器里
   * 实测到的正是这条）。
   *
   * 锚定之后，「用户看过的那一段」钉在原地、新行列在它**之后**：DOM 节点不重建，
   * 选区自然不会被冲掉；想追最新也可以亲手往下滚。
   *
   * 重取时机（= 用户「转到最新」）：打开面板 / 点「回到最新」 / 换页 / 切筛选 /
   * 搜索 / 用户自己滚到底部。
   */
  anchorId: string | null;
  /**
   * 贴底看最新（true，默认）：面板停在「已看过的最新一条」处，新日志在下面累积。
   * false = 用户手动上滚离开了底部，或自己关掉了自动滚动。
   *
   * 它同时决定页脚「回到最新」出口是否出现（selectShouldPinToLatest），
   * 因此必须与 {@link LogStoreState.setFollowBottom} 一起看在 store 里——
   * 视图只读它，不再各存一份。
   */
  autoScroll: boolean;
  /** 用户滚到底部/离开底部时由视图上报（见 setFollowBottom）。 */
  setFollowBottom: (follow: boolean) => void;
  /** 用户点击「回到最新」：解绑贴底基线并回到第 1 页（见 jumpToLatest）。 */
  jumpToLatest: () => void;
  addEntry: (entry: Omit<LogEntry, "id" | "time" | "seq">) => void;
  appendFileLogs: (entries: LogEntry[]) => void;
  setSessionStart: (sessionStart: number | null) => void;
  /** 记录当前服务端进程标识；变化时清掉时间线（跨进程的行不可比）。 */
  setBootId: (bootId: string | null) => void;
  setFilter: (f: LogFilter) => void;
  setOrigin: (o: LogOriginFilter) => void;
  setSearch: (s: string) => void;
  setPage: (page: number) => void;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  clear: () => void;
  /** 复制当前筛选下的全部日志；返回值 = 是否真的进了剪贴板（反馈归面板，§16.2.4.43）。 */
  copyAll: () => Promise<boolean>;
  download: () => void;
  /**
   * 把当前筛选下的**全部日志**保存到本机 `log/exports/`（返回落盘路径）。
   *
   * 与 `download` 并存而不是替换：浏览器下载在桌面壳里不一定真的落盘，而排障
   * 现场要的是「文件确实在、路径说得出」（ISSUE #609 反馈第 3 条）。
   */
  saveExport: (label: string) => Promise<SavedLogExport>;
}

/** 面板渲染一帧需要的全部状态（`LogPanelState` 的别称，视图侧更短的写法）。 */
export type LogPanelState = LogStoreState;

/**
 * 面板状态切片（`LogPanel()` 内部那个 `useLogPanel(state => state.panel)`）。
 *
 * 面板订阅的是**状态本身**：store 只在时间线/筛选真正变化时才重建这些对象，
 * 因此选它不会引入逐帧比较。这样写而不是在视图里用 `useShallow` 现拼对象，
 * 是为了让「面板读哪些状态」这件事只写一遍、只在一个文件里（视图层零状态拼装）。
 */
export interface LogPanelSlice {
  filteredLogs: LogEntry[];
  filter: LogFilter;
  origin: LogOriginFilter;
  search: string;
  isOpen: boolean;
  counts: LogLevelCounts;
  countsByOrigin: LogOriginCounts;
  page: number;
  pageSize: number;
  bootId: string | null;
  /** 贴底看最新（见 {@link LogStoreState.autoScroll}）。 */
  autoScroll: boolean;
  /** 第 1 页窗口的锚点（见 {@link LogStoreState.anchorId}）。 */
  anchorId: string | null;
  /** 「已翻过去的历史」条数（见 {@link LogStoreState.viewBaselineAfter}）。 */
  viewBaselineAfter: number;
}

/**
 * 派生出「时间线 + 计数 + 过滤结果」这三件随时间线走的东西。
 *
 * 不碰视图状态（当前页 / 已读水位 / 来源 / 级别 / 搜索）——那些由
 * {@link applyView} 收口，保证 `header` 切片永远反映的是**写入之后**的状态，
 * 而不是写入前那一份。
 */
function derive(
  logs: LogEntry[],
  filter: LogFilter,
  search: string,
  origin: LogOriginFilter,
  revision: number,
) {
  return {
    logs,
    counts: computeCounts(logs, search),
    countsByOrigin: computeOriginCounts(logs, search),
    filteredLogs: computeFiltered(
      logs,
      filter,
      search,
      origin,
      disabledCategories(),
    ),
    revision,
  };
}

/** 从当前状态里摘出视图那几项（`applyView` 的入参形状）。 */
function viewOf(state: LogStoreState): LogPanelView {
  return {
    filter: state.filter,
    origin: state.origin,
    search: state.search,
    isOpen: state.isOpen,
    page: state.page,
    pageSize: state.pageSize,
    bootId: state.bootId,
    autoScroll: state.autoScroll,
    anchorId: state.anchorId,
    viewBaselineAfter: state.viewBaselineAfter,
  };
}

/** 视图状态（筛选条件 + 页码 + 收缩状态），`applyView` 的入参。 */
interface LogPanelView {
  filter: LogFilter;
  origin: LogOriginFilter;
  search: string;
  isOpen: boolean;
  page: number;
  pageSize: number;
  bootId: string | null;
  autoScroll: boolean;
  anchorId: string | null;
  viewBaselineAfter: number;
}

/**
 * 把视图状态与派生字段合成一次 `set` 的载荷。
 *
 * 面板订阅的状态切片（`header`）必须是**写入之后**的状态：`set` 的浅合并不会
 * 回头替我们重算切片，若某条写入路径忘了带上它，面板上就是「来源已经切了、
 * 计数还停在切之前」。所有改视图状态的路径都从这里出去，这一条就不会漏。
 *
 * `filteredLogs` 按**合并后的视图**重算（几百毫秒才变一次的时间线上，这点开销
 * 换「少一个会漂移的中间量」是划算的）；`page` 由调用方先钳好再传进来。
 */
function applyView(derived: ReturnType<typeof derive>, view: LogPanelView) {
  const filteredLogs = computeFiltered(
    derived.logs,
    view.filter,
    view.search,
    view.origin,
    disabledCategories(),
  );
  return {
    ...derived,
    ...view,
    filteredLogs,
    header: {
      filteredLogs,
      filter: view.filter,
      origin: view.origin,
      search: view.search,
      isOpen: view.isOpen,
      counts: derived.counts,
      countsByOrigin: derived.countsByOrigin,
      page: view.page,
      pageSize: view.pageSize,
      bootId: view.bootId,
      autoScroll: view.autoScroll,
      anchorId: view.anchorId,
      viewBaselineAfter: view.viewBaselineAfter,
    },
  };
}

export const useLogStore = create<LogStoreState>((set, get) => ({
  logs: typeof window === "undefined" ? [] : [welcomeEntry()],
  filteredLogs: [],
  filter: "all",
  origin: "all",
  search: "",
  isOpen: false,
  counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
  countsByOrigin: computeOriginCounts([]),
  header: {
    filteredLogs: [],
    filter: "all",
    origin: "all",
    search: "",
    isOpen: false,
    counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
    countsByOrigin: computeOriginCounts([]),
    page: 1,
    pageSize: LOG_PAGE_SIZE,
    bootId: null,
    autoScroll: true,
    anchorId: null,
    viewBaselineAfter: 0,
  },
  page: 1,
  pageSize: LOG_PAGE_SIZE,
  autoScroll: true,
  sessionStart: null,
  bootId: null,
  revision: 0,
  viewRevision: 0,
  viewSeenIds: new Set<string>(),
  viewBaselineAfter: 0,
  followBaseline: 0,
  followResetAt: 0,
  anchorId: null,

  addEntry: (entry) =>
    set((state) => {
      const full: LogEntry = {
        ...entry,
        id: nextId(),
        seq: nextSeq(),
        time: Date.now(),
      };
      const logs = mergeTimeline(state.logs, [full]);
      return applyView(
        derive(
          logs,
          state.filter,
          state.search,
          state.origin,
          state.revision + 1,
        ),
        viewOf(state),
      );
    }),

  appendFileLogs: (entries) =>
    set((state) => {
      const fresh = dropStaleEntries(entries, state.sessionStart);
      /* 空批次直接原样返回：计数/过滤结果不变（setState 浅合并，不覆盖
       * counts），与「追加空数组时状态保持不变」的既有契约一致。 */
      if (fresh.length === 0) return { logs: state.logs };
      const logs = mergeTimeline(state.logs, fresh);
      /* 全批是重复行（或全被会话起点裁掉）→ 时间线没变，什么都不推进。 */
      if (logs === state.logs) return { logs: state.logs };
      /* mergeTimeline 返回新数组 ⟺ 至少一条新行真正落板。时间线不设总数上限，
       * 不存在「产生了新数组、新行却被裁掉」的形态——2000 条环形缓冲的时代，
       * 截断会把旧行挤出去，必须按条目身份另问一遍「有没有新行」（规范 §7.22.4）；
       * **将来若恢复内存上限，那条身份判据必须一并恢复**：截断不算新内容落板。
       * `revision` 只在真落了新行时推进，页脚「有 N 条新的日志」与贴底基线
       * 才不会被「时间线右移一格」这种形态虚报。 */
      return applyView(
        derive(
          logs,
          state.filter,
          state.search,
          state.origin,
          state.revision + 1,
        ),
        viewOf(state),
      );
    }),

  /* 会话起点到达得比首次轮询晚时，时间线里可能已经混进了上次运行的行：
   * 一次性收拢到底。应用运行中的 mtime 不会后移，因此这是幂等操作。 */
  setSessionStart: (sessionStart) =>
    set((state) => {
      const logs = dropStaleEntries(state.logs, sessionStart);
      const changed = logs.length !== state.logs.length;
      return {
        sessionStart,
        ...applyView(
          derive(
            logs,
            state.filter,
            state.search,
            state.origin,
            changed ? state.revision + 1 : state.revision,
          ),
          viewOf(state),
        ),
      };
    }),

  /* 服务端进程标识变化 = 真的换了进程。旧时间线里的行属于上一个进程，与本次
   * 会话没有可比性（且新进程会从头写自己的日志文件），一次性清干净并重置游标；
   * 页脚随后会显示新的标识。 */
  setBootId: (bootId) =>
    set((state) => {
      if (state.bootId === bootId) return {};
      /* 只有「从无到有 / 换了一个」才算换进程：首次拿到标识时时间线里还没有
       * 旧进程的行，不必清。 */
      const changed = state.bootId !== null && state.bootId !== bootId;
      return {
        bootId,
        ...(changed
          ? {
              ...applyView(
                derive(
                  [],
                  state.filter,
                  state.search,
                  state.origin,
                  state.revision + 1,
                ),
                // 视图入参取自写入前的 state，切片里的 bootId 在这里显式补齐
                { ...viewOf(state), bootId, page: 1 },
              ),
              viewRevision: state.revision + 1,
              viewSeenIds: new Set<string>(),
              viewBaselineAfter: 0,
              followResetAt: Date.now(),
              anchorId: null,
            }
          : { header: { ...state.header, bootId } }),
      };
    }),

  setFilter: (f) =>
    set((state) => {
      const next = {
        ...viewOf(state),
        filter: f,
        /* 过滤条件变了，当前页多半越界：
        回到最新一页，避免用户停在空白页。 */ page: 1,
      };
      const derived = derive(
        state.logs,
        next.filter,
        next.search,
        next.origin,
        state.revision,
      );
      return {
        ...applyView(derived, next),
        /* 过滤条件变了 = 用户看到的这一段也变了：水位换成切完之后的那一段，
         * 新到的行仍留在水位之外，页脚的「有 N 条新的日志」因此不会凭空归零。 */
        viewSeenIds: currentWatermark(state),
        viewRevision: state.revision,
        /* 切筛选 / 搜索都会把页码拉回第 1 页 → 窗口就是最新一段，基线归零。 */
        viewBaselineAfter: 0,
        followResetAt: 0,
        ...anchorOf(state),
      };
    }),

  setOrigin: (o) =>
    set((state) => {
      const next = { ...viewOf(state), origin: o, page: 1 };
      const derived = derive(
        state.logs,
        next.filter,
        next.search,
        next.origin,
        state.revision,
      );
      return {
        ...applyView(derived, next),
        /* 过滤条件变了 = 用户看到的这一段也变了：水位换成切完之后的那一段，
         * 新到的行仍留在水位之外，页脚的「有 N 条新的日志」因此不会凭空归零。 */
        viewSeenIds: currentWatermark(state),
        viewRevision: state.revision,
        /* 切筛选 / 搜索都会把页码拉回第 1 页 → 窗口就是最新一段，基线归零。 */
        viewBaselineAfter: 0,
        followResetAt: 0,
        ...anchorOf(state),
      };
    }),

  setSearch: (s) =>
    set((state) => {
      const next = { ...viewOf(state), search: s, page: 1 };
      const derived = derive(
        state.logs,
        next.filter,
        next.search,
        next.origin,
        state.revision,
      );
      return {
        ...applyView(derived, next),
        /* 过滤条件变了 = 用户看到的这一段也变了：水位换成切完之后的那一段，
         * 新到的行仍留在水位之外，页脚的「有 N 条新的日志」因此不会凭空归零。 */
        viewSeenIds: currentWatermark(state),
        viewRevision: state.revision,
        /* 切筛选 / 搜索都会把页码拉回第 1 页 → 窗口就是最新一段，基线归零。 */
        viewBaselineAfter: 0,
        followResetAt: 0,
        ...anchorOf(state),
      };
    }),

  /* 翻页 = 用户「把这一刻的时间线当作已读基准」：水位取到当前位置，此后新增的
   * 行才算「新来的」，页脚据此报数（ISSUE #346）。
   *
   * 水位**不能**按「切完之后那一页的内容」取：停在第 3 页时说「我只看到这 200 条」
   * 并不成立——比他更新、他已经放弃追赶的那一大段同样不该算「新的」。实测正是
   * 这个错法让页脚从「有 401 条新的日志」开始报数（#262 复审）。
   *
   * 贴底基线同时按当前水位重取：换页 = 用户要在这里停下来看，新行只累积不推动。 */
  setPage: (page) =>
    set((state) => {
      const nextPage = Math.max(1, page);
      const seen = currentWatermark(state);
      return {
        page: nextPage,
        header: { ...state.header, page: nextPage },
        viewSeenIds: seen,
        viewRevision: state.revision,
        /* 「已翻过去的历史」= 第 1 页之外、压在这一页上面的那些条数。
         * 第 1 页恒为 0（窗口就是最新一段，其后本来就没有东西），否则用户一停下
         * 就会被报「有 200 条新的日志」——而那 200 条是他自己刚翻过去的。 */
        viewBaselineAfter:
          nextPage === 1
            ? 0
            : countAfterPage(
                state.filteredLogs.length,
                nextPage,
                state.pageSize,
              ),
        followBaseline: Math.max(0, state.filteredLogs.length - 1),
        followResetAt: 0,
        ...anchorOf(state),
      };
    }),

  /**
   * 贴底看最新 vs. 追最新：贴底（true）时面板按水位停在用户读过的地方，日志
   * 只在下面累积（页脚给出新增条数）；追最新（false）时不再自动滚动。
   *
   * `autoScroll` 过去只在视图层的 useState 里，现在同时写进 store：贴底基线的
   * 解绑（{@link followBaseline}）与视图的贴底判定必须用同一份状态，否则会出现
   * 「面板说不自动滚动、却仍在滚」这种两边各说各话的形态。
   */
  setFollowBottom: (follow) =>
    set((state) => ({
      autoScroll: follow,
      /* 用户自己滚回底部 = 他主动追最新：锚点与贴底基线一起重取，此后新行继续
       * 从他看的位置往下排。 */
      ...(follow
        ? {
            followResetAt: Date.now(),
            viewBaselineAfter: 0,
            followBaseline: followBaselineOf(state),
            ...anchorOf(state),
          }
        : {}),
      header: { ...state.header, autoScroll: follow },
    })),

  /** 用户显式要求「回到最新」：解绑贴底基线，此后贴底一路追到最新。 */
  jumpToLatest: () =>
    set((state) => ({
      followResetAt: Date.now(),
      autoScroll: true,
      followBaseline: followBaselineOf(state),
      ...anchorOf(state),
      header: { ...state.header, autoScroll: true, page: 1 },
      page: 1,
    })),
  setIsOpen: (open) =>
    set((state) => ({
      isOpen: open,
      header: { ...state.header, isOpen: open },
    })),
  toggleOpen: () =>
    set((state) => {
      const isOpen = !state.isOpen;
      /* 打开面板 = 用户此刻看到的是「最新的那一段」：水位与贴底基线一起取到当前，
       * 后续新到的行才算「新的」。面板开着不动时两者都不随新日志前进，这正是
       * 「内容不要自己动」的实现（ISSUE #262 复审）。 */
      return {
        isOpen,
        header: { ...state.header, isOpen },
        ...(isOpen
          ? {
              viewSeenIds: currentWatermark(state),
              followBaseline: followBaselineOf(state),
              followResetAt: 0,
              ...anchorOf(state),
            }
          : {}),
      };
    }),

  clear: () =>
    set((state) => {
      const view = { ...viewOf(state), page: 1 };
      return {
        ...applyView(
          derive([], view.filter, view.search, view.origin, state.revision + 1),
          view,
        ),
        /* 清空后不再有「已读 / 未读」可言：水位里保留的那些 id 已经不在时间线上，
         * 下次新日志直接按「没取过水位」处理（水位为空即按「当前看到的全部」处理），贴底基线同时解绑，
         * 此后贴底直接追到最新。 */
        viewRevision: state.revision + 1,
        viewSeenIds: new Set<string>(),
        viewBaselineAfter: 0,
        followResetAt: Date.now(),
        anchorId: null,
      };
    }),

  /* 复制的范围 = **当前筛选下的全部日志**（来源 × 级别 × 搜索词，跨所有页），
   * 而不是「全部日志」也不是「当前这一页」。用户诉求原文：「复制日志，需要只
   * 复制当前选择类型的全部日志」——他先把来源/级别收窄到想看的那一类，再按下
   * 复制，期望拿到的就是这一类；此前不分范围地倒出面板里的所有行（含 2000 行
   * 之外的其他来源、启动噪音），用户还得自己去里面挑（ISSUE #609）。
   *
   * `filteredLogs` 正是这个范围：它与面板显示的行同源（同一个 computeFiltered），
   * 只是不受分页窗口限制——「全部日志」指的是一整类，不是一页。 */
  copyAll: () => copyLogText(formatForClipboard(get().filteredLogs)),
  download: () => downloadLogText(formatForClipboard(get().filteredLogs)),
  saveExport: (label) =>
    saveLogExport(label, formatForClipboard(get().filteredLogs)),
}));

/* ── 分类开关联动：设置页关掉某类日志后，面板实时隐藏对应行 ───────
 * 分类开关住在独立的 `useLogCategoryStore`（设置页与面板共享）。它在被改写时
 * 本 store 并不知道，因此这里订阅它：`enabled` 一变就按**合并后的视图**重算
 * `filteredLogs`（`derive` 已把 disabled 集合塞进 computeFiltered）。仅当
 * `enabled` 引用变化才重算，避免其它字段改动（如未来新增的字段）触发无谓重排。
 * 无 DOM 环境（SSR / node 测试）下订阅同样安全：读不到 localStorage 就取默认开启，
 * 且订阅本身不触碰 DOM，只是一次状态重算。 */
useLogCategoryStore.subscribe((state, prev) => {
  if (state.enabled === prev.enabled) return;
  const s = useLogStore.getState();
  useLogStore.setState(
    applyView(
      derive(s.logs, s.filter, s.search, s.origin, s.revision),
      viewOf(s),
    ),
  );
});

/* ── 已读水位与贴底基线 ─────────────────────────────────────────────── */

/**
 * 「已读水位」的内容：**已读过哪些条目**（id 集合）。
 *
 * 用条目身份而不是条数，是本文件在 ISSUE #262 复审里改掉的一条口径。条数在
 * **时间线有上限**时不再是单调量：2000 条环形缓冲的时代长度会停在常数上，
 * 于是「当前长度 − 上次长度」恒为 0——页脚永远报不出「有 N 条新的日志」，
 * 用户也就永远等不到那个「回到最新」的入口（现场实测：页脚写着
 * 「面板保留最近 2000 条」，却一直是第 1 页）。现行时间线无上限，长度重新
 * 变成单调量，但身份口径仍然保留：它不受将来任何上限策略的影响。
 *
 * 身份口径下，新条目（id 新）天然不在水位里，被挤掉多少条旧行都不影响计数，
 * 因此贴底位置也不会被截断反复拉动。
 */
function watermarkIds(entries: LogEntry[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of entries) ids.add(entry.id);
  return ids;
}

/**
 * 取「已读水位」：**此刻时间线里已有的全部条目**。
 *
 * 语义是「用户把这一刻当作分界——此刻之前的不算新的，之后到的才算」。
 *
 * ⚠️ 水位只能由**显式动作**整体替换（翻页 / 切筛选 / 搜索 / 打开面板），不能在
 * 每次写入新日志时「顺手扩展」。写日志时扩展，会让水位**追着最新跑**：写入之后
 * 的视图里本来就含新行，扩展一步等于把刚到的行直接标成已读，页脚于是永远报 0
 * ——用户看到的就是「面板一直在涨，却从来不提示有新的」（ISSUE #262 复审）。
 *
 * 也不能只取「当前这一页那 200 条」。停在第 2 页时说「我只看到这 200 条」并不
 * 成立：比他更新、他已经放弃追赶的那一大段同样不该算「新的」。实测正是这个错法
 * 让页脚从「有 401 条新的日志」开始报数（#262 复审）。
 */
function currentWatermark(state: LogStoreState): ReadonlySet<string> {
  return watermarkIds(state.filteredLogs);
}

/** 打开面板 / 首次取水位时的基准：当前这一段就是用户正在看的。 */
function followBaselineOf(state: LogStoreState): number {
  return Math.max(0, state.filteredLogs.length - 1);
}

/**
 * 重取第 1 页锚点：当前窗口（尾部 pageSize 条）的头一条。
 *
 * 「转到最新」的每个动作都调用它——打开面板 / 点回到最新 / 换页 / 切筛选 / 搜索 /
 * 用户自己滚到底部。除此之外锚点不动，这是「看得正起劲的那一段不要被新日志推走」
 * 的实现（见 `anchorId` 的完整说明）。
 */
function anchorOf(state: LogStoreState): { anchorId: string | null } {
  return { anchorId: headOfFirstPage(state) };
}

function headOfFirstPage(state: LogStoreState): string | null {
  /* 第 1 页的头一条 = 「尾部窗口」的第一条（`~/lib/page-window`）。 */
  return tailWindow(state.filteredLogs, state.pageSize)[0]?.id ?? null;
}

/* ── 派生视图：面板怎么切一页 ───────────────────────────────────────── */

/**
 * 按时间倒序分页：第 1 页是最新的一段，往前翻看更早的日志。
 *
 * 分页在**过滤后的时间线**上做（filteredLogs 顺序即时间顺序），因此
 * 「最新一页」总在 page=1，与 `counts.all` 无关。
 */
export function selectPageLogs(
  logs: LogEntry[],
  page: number,
  pageSize: number,
): { entries: LogEntry[]; page: number; totalPages: number } {
  /* 倒序分页的算式收在 `~/lib/page-window`（规范 16 §16.2.4.67）——
   * 同一份账（越界页码钳回、`pageSize` 为 0 不许给出 `Infinity` 页）
   * 此前在这里与视图侧各算一遍。 */
  return tailPages(logs, page, pageSize);
}

/**
 * 第 1 页的**锚定**窗口：只要锚点还在时间线里，就以它为起点往后取 pageSize 条。
 *
 * 锚点不在（还没设）→ 退回「尾部 pageSize 条」这个默认窗口。
 * 返回的 `truncatedFromEnd` 说明窗口后面还有多少条**更新的**日志，页脚据此说
 * 「有 N 条新的日志」——它就是「用户还没看的那批」。
 *
 * 为什么不能一直用「尾部 pageSize 条」：窗口每一轮轮询都整体前移一格，React 会
 * 卸载最上面那一条、挂上新的最末一条。用户刚框住的文本随节点被卸载，选区消失
 * （ISSUE #262 复审在真实浏览器里实测到的正是这条）。锚定之后窗口原地不动，
 * DOM 节点不重建，选区自然留住。
 */
export function selectFirstPageWindow(
  logs: LogEntry[],
  anchorId: string | null,
  pageSize: number,
): { entries: LogEntry[]; truncatedFromEnd: number } {
  const size = Math.max(1, pageSize);
  if (anchorId !== null) {
    const at = logs.findIndex((entry) => entry.id === anchorId);
    if (at !== -1) {
      const entries = logs.slice(at, at + size);
      return { entries, truncatedFromEnd: logs.length - (at + entries.length) };
    }
  }
  return { entries: tailWindow(logs, size), truncatedFromEnd: 0 };
}

/**
 * 面板是否「已经不在最新」：不在第 1 页，或用户手动上滚离开了底部。
 * 两者都必须给「回到最新」出口，否则用户会以为日志不再刷新（ISSUE #262）。
 */
export function selectShouldPinToLatest(
  page: number,
  autoScroll: boolean,
): boolean {
  return page !== 1 || !autoScroll;
}

/**
 * 停在历史位置期间新来了多少条日志。
 *
 * 判据分两层，缺一不可：
 *   1. `revision` 变过 —— 时间线**真的**变过（不是「末条变了」：按时刻排序后，
 *      一条迟到的旧时刻行会插进中间、末条不动）；
 *   2. 用户当前窗口**之后**确实还有日志 —— 条数由锚定窗口的 `truncatedFromEnd`
 *      直接给出（见 selectFirstPageWindow）。长度差在这里是不管用的：第 1 页窗口
 *      锚定之后长度不再变化，时间线封顶时长度差更是恒为 0（ISSUE #262 复审）。
 *
 * ⚠️ `revision` 在这里仍是门槛，所以**环形缓冲截断不能推进它**：截断只是把最旧
 * 的一批挤出去，新行如果推进了 revision，下面的计数就会把「写入之后视图里本来就
 * 含新行」当成已读，报出 0（用户读到的就是「翻页翻不动、提示不出现」）。
 */
export function selectNewLogCount(state: {
  /** 当前窗口之后还有多少条更新的日志。 */
  unseenAfterView: number;
  /**
   * 用户翻到这一页那一刻，窗口之后本来就有多少条（「已翻过去的历史」）。
   *
   * 计数必须减掉它，否则停在第 2 页时会一开口就报「有 200 条新的日志」——
   * 那 200 条是用户**自己翻过去的**，不是新来的（现场实测过这个错法）。
   * 第 1 页这个值是 0（窗口就是最新一段，其后本来就没有东西）。
   */
  baselineAfterView: number;
  page: number;
  autoScroll: boolean;
}): number {
  if (!selectShouldPinToLatest(state.page, state.autoScroll)) return 0;
  return Math.max(0, state.unseenAfterView - state.baselineAfterView);
}
