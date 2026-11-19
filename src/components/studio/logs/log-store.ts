"use client";

/**
 * log-store — 日志面板全局状态单例（Zustand）。规范 07 §7.4：日志状态用 Zustand、不用 React Context。
 * 时间线契约：① 排序键 `(time, seq)`，seq 只是同毫秒内稳定次键；② 多路读到的同一行按
 * `time + level + message` 去重；③ 读不到时刻的裸文本行钳到当时本地时刻，不落到历史行之前（ISSUE #346）。
 */

import { countAfterPage, tailPages, tailWindow } from "~/lib/page-window";

import { create } from "zustand";

import {
  saveDiagnosticsPackage,
  saveLogExport,
  type SavedLogExport,
} from "~/lib/log/log-file-client";

import { copyLogText, downloadLogText } from "./log-export";
import { formatForClipboard } from "./log-format";
import { disabledCategories, useLogCategoryStore } from "./log-category-store";

/* 格式化口径落在 log-format（视图与 store 共用一份）；这里按原路径转出，
 * 既有导入（测试、面板）逐字不变。 */
export { formatEntryForClipboard, formatForClipboard, formatTime } from "./log-format";
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
  indexOfTimeline,
  mergeTimelineIndexed,
  nextId,
  nextSeq,
  rememberTimelineIndex,
  trimTimelineIndex,
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

export type LogStoreState = {
  addEntry: (entry: Omit<LogEntry, "id" | "time" | "seq">) => void;
  /**
   * 第 1 页窗口的**锚点**：用户「正在看的那一段」的头一条 id（null = 不锚定）。不锚定时窗口每来新行
   * 就前移一格，React 卸载最上面那条、挂上新的最末条，用户刚框住的文本随节点卸载而消失（ISSUE #262 复审）。
   * 锚定后窗口原地不动，新行列在其后；打开面板 / 回到最新 / 换页 / 切筛选 / 搜索 / 滚到底时重取。
   */
  anchorId: string | null;
  appendFileLogs: (entries: Array<LogEntry>) => void;
  /**
   * 贴底看最新（true，默认）：面板停在「已看过的最新一条」，新日志在下面累积；false = 用户手动上滚
   * 离开底部或关掉了自动滚动。它同时决定页脚「回到最新」出口是否出现（selectShouldPinToLatest），
   * 必须与 `setFollowBottom` 一起看在 store 里，视图只读、不再各存一份。
   */
  autoScroll: boolean;
  /**
   * 当前提供日志的服务端进程标识（bootId）。进程重启（或另一实例接管端口）后它变化，
   * 面板据此清空时间线并重读，而不是把两个进程的输出混成一条线；页脚展示它，
   * 报障时能说清连的是哪个进程（ISSUE #360）。
   */
  bootId: string | null;
  clear: () => void;
  /** 复制当前筛选下的全部日志；返回值 = 是否真的进了剪贴板（反馈归面板，§16.2.4.43）。 */
  copyAll: () => Promise<boolean>;
  counts: LogLevelCounts;
  /**
   * 每个来源各自的级别计数（含 `all` 汇总）：面板在级别按钮与来源下拉上各显示
   * 一份，用户不必先切来源才知道那边有几个警告（见 computeOriginCounts）。
   */
  countsByOrigin: LogOriginCounts;
  download: () => void;
  /**
   * 因内存上限（`LOG_STORE_MAX`）被折叠掉的更早日志**累计**条数。上限是刻意
   * 恢复的（见 appendFileLogs：真新行才推进 revision、截断不推进，满足文件早先
   * 「将来若恢复上限须恢复身份判据」的约束）。面板据此显示「更早 N 条已折叠」。
   */
  droppedTotal: number;
  filter: LogFilter;
  filteredLogs: Array<LogEntry>;
  /**
   * 「贴底基线」：面板开着且用户贴着底看时，**只追到这里**。此前「内容一变就滚到
   * scrollHeight」几乎每轮轮询都成立，内容每两秒整体上移、刚框住的文本被冲掉（ISSUE #262 复审）；
   * 现在只追到面板打开时已看过的最后一条，新行默默累积，页脚给「有 N 条新的日志 · 回到最新」。
   */
  followBaseline: number;
  /**
   * 用户主动按下「回到最新」的时刻；此后贴底直接追到最新，不再受
   * {@link followBaseline} 约束。
   */
  followResetAt: number;
  /**
   * 面板渲染一帧所需的全部状态（见 {@link LogPanelSlice}）。
   * 它随时间线或筛选变化整体重建，面板只订阅这一个字段，视图不必自己拼装状态，
   * 也就不会出现「来源切了、计数还停在切之前」这类漏项。
   */
  header: LogPanelSlice;
  isOpen: boolean;
  /** 用户点击「回到最新」：解绑贴底基线并回到第 1 页（见 jumpToLatest）。 */
  jumpToLatest: () => void;
  logs: Array<LogEntry>;
  /** 来源筛选（#262：启动日志与应用运行日志混在一屏，需要能分开看）。 */
  origin: LogOriginFilter;
  /** 翻页：当前页（1 起，倒序查看，1 = 最新一页）与每页条数。 */
  page: number;
  pageSize: number;
  /**
   * 生成 `logs` 切片的生成号（每次时间线变化 +1）。
   * 它是「store 有没有新日志」的判据，而不是末条 seq：时间线按时刻排序，一条迟到但
   * 时刻更早的行会插进中间、末条不变——只看末条会漏掉这种新增。
   */
  revision: number;
  /** 打包整份诊断现场（跑 `current/` + 最近几次 `runs/`，见 log-file-client）。 */
  saveDiagnostics: () => Promise<SavedLogExport>;
  /**
   * 把当前筛选下的**全部日志**保存到本机 `log/exports/`（返回落盘路径）。
   * 与 `download` 并存而不替换：浏览器下载在桌面壳里不一定真的落盘，排障要的是
   * 「文件确实在、路径说得出」（ISSUE #609 反馈第 3 条）。
   */
  saveExport: (label: string) => Promise<SavedLogExport>;
  search: string;
  /**
   * 本次运行的开始时间（毫秒）；null = 未知（非 launcher 启动）。
   * 面板只显示本次运行：行时刻早于它即上一次运行的残留（见 dropStaleEntries）。
   */
  sessionStart: number | null;
  /** 记录当前服务端进程标识；变化时清掉时间线（跨进程的行不可比）。 */
  setBootId: (bootId: string | null) => void;
  setFilter: (f: LogFilter) => void;
  /** 用户滚到底部/离开底部时由视图上报（见 setFollowBottom）。 */
  setFollowBottom: (follow: boolean) => void;
  setIsOpen: (open: boolean) => void;
  setOrigin: (o: LogOriginFilter) => void;
  setPage: (page: number) => void;
  setSearch: (s: string) => void;
  setSessionStart: (sessionStart: number | null) => void;
  toggleOpen: () => void;
  /**
   * 「已翻过去的历史」：翻到这一页那一刻，窗口之后本来就有多少条。
   * 页脚「有 N 条新的日志」= 窗口之后的条数 − 它，否则停在第 2 页会一开口就报
   * 「有 200 条新的日志」——那 200 条是用户自己翻过去的。第 1 页恒为 0。
   */
  viewBaselineAfter: number;
  /**
   * 「已读水位」的生成号：翻到历史页那一刻的 `revision`。判据是 `revision` 变化（时间线真的
   * 变过）而不是「末条变了」——迟到的旧时刻行会插进中间、末条不动（ISSUE #346）。⚠️ `revision`
   * 只在**新行落板**时推进：截断不算落板，推进它会让新日志被当成已读、页脚永远报 0（ISSUE #262 复审）。
   */
  viewRevision: number;
  /**
   * 「已读水位」：翻到历史位置那一刻**已经看到**的条目。
   * 它是 `selectNewLogCount` 的输入，回答「我看到的之后又来了几条」；同时决定贴底滚到哪，
   * 两者用同一份水位，「说有几条新的」与「实际滚到哪」不会各说各话。
   */
  viewSeenIds: ReadonlySet<string>;
};

/** 面板渲染一帧需要的全部状态（`LogPanelState` 的别称，视图侧更短的写法）。 */
export type LogPanelState = LogStoreState;

/**
 * 面板状态切片（`LogPanel()` 内部的 `useLogPanel(state => state.panel)`）。
 * 面板订阅**状态本身**：store 只在时间线/筛选真正变化时重建这些对象，选它不会引入逐帧比较。
 * 这样写而不是视图里用 `useShallow` 现拼，是为了让「面板读哪些状态」只写一遍。
 */
export type LogPanelSlice = {
  /** 第 1 页窗口的锚点（见 {@link LogStoreState.anchorId}）。 */
  anchorId: string | null;
  /** 贴底看最新（见 {@link LogStoreState.autoScroll}）。 */
  autoScroll: boolean;
  bootId: string | null;
  counts: LogLevelCounts;
  countsByOrigin: LogOriginCounts;
  filter: LogFilter;
  filteredLogs: Array<LogEntry>;
  isOpen: boolean;
  origin: LogOriginFilter;
  page: number;
  pageSize: number;
  search: string;
  /** 「已翻过去的历史」条数（见 {@link LogStoreState.viewBaselineAfter}）。 */
  viewBaselineAfter: number;
};

/**
 * 派生出「时间线 + 计数」这两件随时间线走的东西。不碰视图状态——那些由 {@link applyView}
 * 收口，保证 `header` 切片反映写入之后的状态。⚠️ **`filteredLogs` 不在这里算**（ISSUE #1782）：
 * 它吃合并后的视图，调用点紧接着就会 `applyView` 逐字覆盖；上限 5000 条时实测 2.9ms × 每轮 6 次。
 */
/**
 * 时间线内存上限（刻意值）。超出即折叠最旧的、`droppedTotal` 累计，面板显示
 * 「更早 N 条已折叠」。截断发生在 `mergeTimeline` **之后**，所以不影响
 * 「真新行落板才推进 revision」这条身份判据（见 appendFileLogs 注释）。
 */
export const LOG_STORE_MAX = 5000;

/**
 * 把合并后的时间线裁到上限；返回裁后数组、本次被折叠的条数与被折叠那一段。顺带把去重索引里**已出窗口**的键摘掉（{@link trimTimelineIndex}）：索引按数组引用挂在 `log-analysis` 的进程内缓存上，截断产出新数组必须把索引搬到它名下，否则面板一顶到上限就每轮因未命中退回 O(n) 建表。
 * 摘键是 O(被折叠条数)，与重建整表差一个量级。
 */
function capTimeline(logs: Array<LogEntry>): {
  dropped: number;
  logs: Array<LogEntry>;
} {
  if (logs.length <= LOG_STORE_MAX) {
    return { logs, dropped: 0 };
  }
  const cut = logs.length - LOG_STORE_MAX;
  const droppedEntries = logs.slice(0, cut);
  const kept = logs.slice(cut);
  trimTimelineIndex(indexOfTimeline(logs), droppedEntries);
  rememberTimelineIndex(kept, indexOfTimeline(logs));
  return { logs: kept, dropped: cut };
}

function derive(logs: Array<LogEntry>, search: string, revision: number) {
  return {
    logs,
    counts: computeCounts(logs, search),
    countsByOrigin: computeOriginCounts(logs, search),
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
type LogPanelView = {
  anchorId: string | null;
  autoScroll: boolean;
  bootId: string | null;
  filter: LogFilter;
  isOpen: boolean;
  origin: LogOriginFilter;
  page: number;
  pageSize: number;
  search: string;
  viewBaselineAfter: number;
};

/**
 * 把视图状态与派生字段合成一次 `set` 的载荷。面板订阅的 `header` 必须是**写入之后**的状态：`set` 的
 * 浅合并不会回头重算切片，任何写入路径漏带它，面板上就是「来源切了、计数还停在切之前」——所有改视图
 * 状态的路径都从这里出去。`filteredLogs` 按合并后的视图算是**唯一**计算点（ISSUE #1782）；`page` 由调用方钳好再传入。
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
  droppedTotal: 0,
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

  addEntry: (entry) => {
    set((state) => {
      const full: LogEntry = {
        ...entry,
        id: nextId(),
        seq: nextSeq(),
        time: Date.now(),
      };
      /* 与 `appendFileLogs` 走**同一支**索引复用版合并：`addEntry` 是
       * 控制台 / 系统行的入口，同样是「一条一条来」，同样不该每轮建两张全表
       * Map（见 `appendFileLogs` 的说明）。 */
      const merged = mergeTimelineIndexed(state.logs, [full], indexOfTimeline(state.logs));
      const logs = merged.logs;
      rememberTimelineIndex(logs, merged.index);
      const capped = capTimeline(logs);
      return {
        ...applyView(derive(capped.logs, state.search, state.revision + 1), viewOf(state)),
        droppedTotal: state.droppedTotal + capped.dropped,
      };
    });
  },

  appendFileLogs: (entries) => {
    set((state) => {
      const fresh = dropStaleEntries(entries, state.sessionStart);
      /* 空批次直接原样返回：计数/过滤结果不变（setState 浅合并，不覆盖
       * counts），与「追加空数组时状态保持不变」的既有契约一致。 */
      if (fresh.length === 0) {
        return { logs: state.logs };
      }
      /* 走**索引复用版**：面板每 2s 一轮、六路各写一次，而「这次送来的一两行
       * 是不是新的」若靠就地建两张全表 Map 来判，实测 5000 条时每轮白花
       * 2.27ms（占整次合并的 97%，排序只占 0.11ms）。索引按数组引用缓存在
       * `log-analysis` 里，因此这里只取不建。 */
      const merged = mergeTimelineIndexed(state.logs, fresh, indexOfTimeline(state.logs));
      const logs = merged.logs;
      /* 全批是重复行（或全被会话起点裁掉）→ 时间线没变，什么都不推进。 */
      if (logs === state.logs) {
        return { logs: state.logs };
      }
      rememberTimelineIndex(logs, merged.index);
      /* mergeTimeline 返回新数组 ⟺ 至少一条新行真正落板 → 推进 revision。
       * 内存上限（LOG_STORE_MAX）的截断放在 mergeTimeline **之后**、独立于
       * revision 判据：revision 只因为「真有新行落板」推进，截断本身不算新内容
       * 落板（满足文件早先「将来若恢复上限须恢复身份判据」的约束）。被截掉的
       * 旧行累计进 droppedTotal，面板据此显示「更早 N 条已折叠」。 */
      const capped = capTimeline(logs);
      return {
        ...applyView(derive(capped.logs, state.search, state.revision + 1), viewOf(state)),
        droppedTotal: state.droppedTotal + capped.dropped,
      };
    });
  },

  /* 会话起点到达得比首次轮询晚时，时间线里可能已经混进了上次运行的行：
   * 一次性收拢到底。应用运行中的 mtime 不会后移，因此这是幂等操作。 */
  setSessionStart: (sessionStart) => {
    set((state) => {
      const logs = dropStaleEntries(state.logs, sessionStart);
      const changed = logs.length !== state.logs.length;
      return {
        sessionStart,
        ...applyView(
          derive(logs, state.search, changed ? state.revision + 1 : state.revision),
          viewOf(state),
        ),
      };
    });
  },

  /* 服务端进程标识变化 = 真的换了进程。旧时间线里的行属于上一个进程，与本次
   * 会话没有可比性（且新进程会从头写自己的日志文件），一次性清干净并重置游标；
   * 页脚随后会显示新的标识。 */
  setBootId: (bootId) => {
    set((state) => {
      if (state.bootId === bootId) {
        return {};
      }
      /* 只有「从无到有 / 换了一个」才算换进程：首次拿到标识时时间线里还没有
       * 旧进程的行，不必清。 */
      const changed = state.bootId !== null && state.bootId !== bootId;
      return {
        bootId,
        ...(changed
          ? {
              ...applyView(
                derive([], state.search, state.revision + 1),
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
    });
  },

  setFilter: (f) => {
    set((state) => {
      const next = {
        ...viewOf(state),
        filter: f,
        /* 过滤条件变了，当前页多半越界：
        回到最新一页，避免用户停在空白页。 */ page: 1,
      };
      const derived = derive(state.logs, next.search, state.revision);
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
    });
  },

  setOrigin: (o) => {
    set((state) => {
      const next = { ...viewOf(state), origin: o, page: 1 };
      const derived = derive(state.logs, next.search, state.revision);
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
    });
  },

  setSearch: (s) => {
    set((state) => {
      const next = { ...viewOf(state), search: s, page: 1 };
      const derived = derive(state.logs, next.search, state.revision);
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
    });
  },

  /* 翻页 = 用户「把这一刻的时间线当作已读基准」：水位取到当前位置，此后新增的行才算新来的
   * （ISSUE #346）。水位**不能**按「切完之后那一页的内容」取：停在第 3 页时说「只看到这 200 条」
   * 不成立，更新且已放弃追赶的那一大段同样不该算新的（实测据此从「有 401 条新的」开始报）。
   * 贴底基线同时按当前水位重取：换页 = 用户要在这里停下来看，新行只累积不推动。 */
  setPage: (page) => {
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
          nextPage === 1 ? 0 : countAfterPage(state.filteredLogs.length, nextPage, state.pageSize),
        followBaseline: Math.max(0, state.filteredLogs.length - 1),
        followResetAt: 0,
        ...anchorOf(state),
      };
    });
  },

  /**
   * 贴底看最新 vs. 追最新：贴底（true）时面板按水位停在用户读过的地方，日志只在下面累积（页脚给出
   * 新增条数）；追最新（false）时不再自动滚动。`autoScroll` 同时写进 store：贴底基线的解绑与视图的
   * 贴底判定必须用同一份状态，否则会出现「面板说不自动滚动、却仍在滚」。
   */
  setFollowBottom: (follow) => {
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
    }));
  },

  /** 用户显式要求「回到最新」：解绑贴底基线，此后贴底一路追到最新。 */
  jumpToLatest: () => {
    set((state) => ({
      followResetAt: Date.now(),
      autoScroll: true,
      followBaseline: followBaselineOf(state),
      ...anchorOf(state),
      header: { ...state.header, autoScroll: true, page: 1 },
      page: 1,
    }));
  },
  setIsOpen: (open) => {
    set((state) => ({
      isOpen: open,
      header: { ...state.header, isOpen: open },
    }));
  },
  toggleOpen: () => {
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
    });
  },

  clear: () => {
    set((state) => {
      const view = { ...viewOf(state), page: 1 };
      return {
        ...applyView(derive([], view.search, state.revision + 1), view),
        /* 清空后不再有「已读 / 未读」可言：水位里保留的那些 id 已经不在时间线上，
         * 下次新日志直接按「没取过水位」处理（水位为空即按「当前看到的全部」处理），贴底基线同时解绑，
         * 此后贴底直接追到最新。 */
        viewRevision: state.revision + 1,
        viewSeenIds: new Set<string>(),
        viewBaselineAfter: 0,
        followResetAt: Date.now(),
        anchorId: null,
        droppedTotal: 0,
      };
    });
  },

  /* 复制的范围 = **当前筛选下的全部日志**（来源 × 级别 × 搜索词，跨所有页），既不是全部日志
   * 也不是当前这一页（用户诉求原文：「复制日志，需要只复制当前选择类型的全部日志」；ISSUE #609）。
   * `filteredLogs` 正是这个范围：与面板显示的行同源，只是不受分页窗口限制。 */
  copyAll: () => copyLogText(formatForClipboard(get().filteredLogs)),
  download: () => {
    downloadLogText(formatForClipboard(get().filteredLogs));
  },
  saveExport: (label) => saveLogExport(label, formatForClipboard(get().filteredLogs)),
  saveDiagnostics: () => saveDiagnosticsPackage(),
}));

/* ── 分类开关联动：设置页关掉某类日志后，面板实时隐藏对应行 ───────
 * 分类开关住在独立的 `useLogCategoryStore`（设置页与面板共享）；这里订阅它，`enabled` 一变
 * 就按合并后的视图重算 `filteredLogs`，仅当引用变化才重算。SSR / node 下同样安全（不触碰 DOM）。 */
useLogCategoryStore.subscribe((state, prev) => {
  if (state.enabled === prev.enabled) {
    return;
  }
  const s = useLogStore.getState();
  useLogStore.setState(applyView(derive(s.logs, s.search, s.revision), viewOf(s)));
});

/* ── 已读水位与贴底基线 ─────────────────────────────────────────────── */

/**
 * 「已读水位」的内容：**已读过哪些条目**（id 集合）。用条目身份而不是条数（ISSUE #262 复审改掉的口径）：
 * 条数在时间线有上限时不再单调，「当前长度 − 上次长度」恒为 0，页脚永远报不出「有 N 条新的日志」；
 * 身份口径下新条目天然不在水位里，被挤掉多少旧行都不影响计数。
 */
function watermarkIds(entries: Array<LogEntry>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    ids.add(entry.id);
  }
  return ids;
}

/**
 * 取「已读水位」：**此刻时间线里已有的全部条目**，语义是「此刻之前的不算新的，之后到的才算」。
 * ⚠️ 只能由显式动作整体替换（翻页 / 切筛选 / 搜索 / 打开面板），写入时不能顺手扩展——否则
 * 刚到的行当场被标成已读、页脚永远报 0（ISSUE #262 复审）；也不能只取当前页那 200 条。
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
 * 「转到最新」的每个动作都调用它——打开面板 / 回到最新 / 换页 / 切筛选 / 搜索 / 滚到底；
 * 除此之外锚点不动，这是「看得正起劲的那一段不要被新日志推走」的实现（见 `anchorId`）。
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
 * 分页在过滤后的时间线（filteredLogs）上做，因此「最新一页」总在 page=1，与 `counts.all` 无关。
 */
export function selectPageLogs(
  logs: Array<LogEntry>,
  page: number,
  pageSize: number,
): { entries: Array<LogEntry>; page: number; totalPages: number } {
  /* 倒序分页的算式收在 `~/lib/page-window`（规范 16 §16.2.4.67）——
   * 同一份账（越界页码钳回、`pageSize` 为 0 不许给出 `Infinity` 页）
   * 此前在这里与视图侧各算一遍。 */
  return tailPages(logs, page, pageSize);
}

/**
 * 第 1 页的**锚定**窗口：锚点还在时间线里就以它为起点往后取 pageSize 条，否则退回尾部默认窗口。
 * 返回的 `truncatedFromEnd` 是窗口后面还有多少条更新的日志，页脚据此说「有 N 条新的日志」。
 * 不能一直用「尾部 pageSize 条」：窗口每轮前移一格会卸载首行、用户选区消失（ISSUE #262 复审）。
 */
export function selectFirstPageWindow(
  logs: Array<LogEntry>,
  anchorId: string | null,
  pageSize: number,
): { entries: Array<LogEntry>; truncatedFromEnd: number } {
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
export function selectShouldPinToLatest(page: number, autoScroll: boolean): boolean {
  return page !== 1 || !autoScroll;
}

/**
 * 停在历史位置期间新来了多少条日志。判据两层：① `revision` 变过（时间线真的变过，迟到的旧时刻行会
 * 插进中间、末条不动）；② 窗口之后确实还有日志——条数由锚定窗口的 `truncatedFromEnd` 给出，长度差
 * 不管用（锚定后长度不变，封顶时长度差恒为 0）。⚠️ 环形缓冲截断不能推进 `revision`。
 */
export function selectNewLogCount(state: {
  autoScroll: boolean;
  /**
   * 用户翻到这一页那一刻，窗口之后本来就有多少条（「已翻过去的历史」）。
   * 计数必须减掉它，否则停在第 2 页会一开口就报「有 200 条新的日志」——那 200 条是
   * 用户自己翻过去的。第 1 页这个值是 0。
   */
  baselineAfterView: number;
  page: number;
  /** 当前窗口之后还有多少条更新的日志。 */
  unseenAfterView: number;
}): number {
  if (!selectShouldPinToLatest(state.page, state.autoScroll)) {
    return 0;
  }
  return Math.max(0, state.unseenAfterView - state.baselineAfterView);
}
