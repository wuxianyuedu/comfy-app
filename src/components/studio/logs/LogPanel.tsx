"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Maximize2,
  Minimize2,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  CONSOLE_ORIGIN,
  dedupeRepeats,
  selectFirstPageWindow,
  selectNewLogCount,
  selectPageLogs,
  selectShouldPinToLatest,
  type LogLevel,
  type LogLevelCounts,
  type LogOriginFilter,
  type LogPanelState,
} from "./log-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { useLogPanel } from "./LogProvider";
import { SaveExportButton } from "./SaveExportButton";
import { FILTER_LABELS, LogFilterBar } from "./LogFilterBar";
import {
  LOG_ROW_SINGLE,
  layoutRows,
  pinPlan,
  pinScrollTop,
  scrollHeightOf,
  visibleRange,
} from "./log-virtual";
import { LOG_PANEL_POPUP_Z_CLASS } from "./log-panel-layers";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { modalWidth } from "~/components/ui/dialog-width";
import { FILTER_SELECTED_STYLES, selectionInsideLogs } from "./log-row-style";
import { LogRow } from "./LogRow";
import { displayValue } from "~/lib/display-value";

/** 单个级别的摘要文案；零条目的级别说「无」——它也是一条信息，不是空白。 */
function levelSummary(label: string, value: number): string {
  return value > 0 ? `${label} ${value}` : `${label}无`;
}

/**
 * 来源下拉里每一项自己的计数摘要（`1822 条 · 信息 1821 · 警告 1 · 错误无`）。
 *
 * 它回答的是「**切过去**会看到多少」，与当前选中的是哪一个无关——所以在
 * 收起状态（扳机/触发按钮）里**不显示**：那是「已经选好了」的地方，数字重复
 * 一遍只占宽度（用户反馈：下拉显示的文本不需要再报一遍每一项有多少，左侧
 * 级别按钮上都看得到）。
 *
 * 打开后的候选列表另走 `SelectItem` 的多列布局（数字右对齐成表），这里只提供
 * 纯文本版本给屏幕阅读器与已选值兜底。
 */
function optionCountsText(counts: LogLevelCounts): string {
  return [
    `${counts.all} 条`,
    levelSummary("信息", counts.info),
    levelSummary("警告", counts.warn),
    levelSummary("错误", counts.error),
  ].join(" · ");
}

/**
 * 计数列（下拉候选列表里每个来源右边的四列数字）。
 *
 * 四列**定宽 + 右对齐 + 等宽数字**是这里的全部要点：宽度随内容变的数字列
 * 排在一起必然参差（`1769` 与 `0` 的视觉差异），读起来就是「对不齐、很难看」。
 * 所以每列显式定宽（`w-14`，容纳最大的四位数），「条」固定在总数那一列里。
 *
 * 零条目一律写「—」且保持灰色：整列 `0` 与「那一行本来就没有这项」长得一样，
 * 而这里要表达的正是「这个来源没有警告」这个**结论**（与级别按钮上显示 `0`
 * 而不隐藏同一条原则）。
 */
function CountColumn({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "warn" | "error";
}) {
  const color =
    value === 0
      ? "text-ink-fainter"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-300"
        : tone === "error"
          ? "text-rose-600 dark:text-rose-300"
          : "text-ink-soft";
  return (
    <span className={`w-14 shrink-0 text-right tabular-nums ${color}`}>
      {/* 计数徽标：**0 是有意义的「无」，不是缺值** —— 所以这里不套
       *  `displayValue`（它会把 0 照常显示成 "0"，那是给「量」用的），而是
       *  显式判 `> 0`，让占位符与屏幕阅读器文案来自同一个判断。 */}
      {value > 0 ? value : displayValue(null)}
      <span className="sr-only">{value > 0 ? ` ${label}` : ` 无${label}`}</span>
    </span>
  );
}

/**
 * 把下拉回传的选中值收窄成来源筛选键。
 *
 * `Select` 的 `value` 是「任意可序列化值」（库的类型是 `any`），而我们只放
 * `LogOriginFilter` 这几个字符串。这里用一个真正的收窄函数而不是 `as`：值若
 * 意外为空/未知，落到「全部来源」这个**安全默认**上，而不是把 `undefined` 塞进
 * 索引里去渲染 `undefined`。
 */
function asOriginFilter(value: unknown): LogOriginFilter {
  return typeof value === "string" && value in ORIGIN_TEXT
    ? (value as LogOriginFilter)
    : "all";
}

/** 下拉候选列表的列宽（列标题与各行共用，列与列才对得上）。 */
const ORIGIN_COLUMNS: {
  key: LogLevel | "all";
  title: string;
  tone: "muted" | "warn" | "error";
}[] = [
  { key: "all", title: "条数", tone: "muted" },
  { key: "info", title: "信息", tone: "muted" },
  { key: "warn", title: "警告", tone: "warn" },
  { key: "error", title: "错误", tone: "error" },
];

/**
 * 级别标签在筛选按钮上的配色。
 *
 * 用户要求很直接：「警告文字改成黄色，错误改成红色」。颜色给**文字**而不是
 * 数字，是因为按 `/警告/` 找过去时，用户扫的是这几个字；数字（`4ch` 定宽）
 * 保持中性灰，才不会出现「两个字都带色、读起来像两个高亮块」。
 *
 * 零条目也照样着色：它表达的仍然是「这一格是警告」，而不是「这里有问题」——
 * 「有没有问题」由数字回答（`0` 与「切过去是空的」互相印证）。
 */
/* 来源筛选（ISSUE #262）：启动日志与应用运行日志此前混在一屏，query 噪音把
 * 业务日志挤掉。分开看是最直接的「让日志有意义」手段。
 *
 * 文案统一取自 ORIGIN_TEXT（此前下拉里叫「启动」、页脚里叫「开发服务」，
 * 同一个来源两种叫法，用户对不上号）。 */
const ORIGIN_LABELS: LogOriginFilter[] = [
  "all",
  "app-runtime",
  "app",
  "dev",
  "launcher",
  CONSOLE_ORIGIN,
];

/**
 * 来源的显示文案（下拉、标题徽标、页脚共用一份，避免同一来源三种叫法）。
 */
const ORIGIN_TEXT: Record<LogOriginFilter, string> = {
  all: "全部来源",
  "app-runtime": "应用运行",
  /** 应用服务自身输出（Next dev server 的 stdout/stderr 转录）。 */
  app: "应用服务",
  dev: "启动",
  launcher: "启动器",
  /* 无文件来源的那些行（浏览器 console 拦截、Tauri 事件、全局未捕获错误）。
   * 文案写「控制台 / 全局错误」而不是「其他」：它回答的是「这批行是谁写的」，
   * 让用户一眼知道切过去能看到什么（`ResizeObserver loop…`、未捕获的 Promise
   * 拒绝都在这里）。 */
  [CONSOLE_ORIGIN]: "控制台 / 全局错误",
};

/**
 * 来源筛选下拉。
 *
 * 用 `Select`（base-ui）而不是原生 `<select>`，只为一件事：**候选列表能排版**。
 * 原生 `<option>` 只接受纯文本、且字体与列宽由 OS 决定，"应用服务 · 1769 条 ·
 * 信息 1769" 与 "启动 · 46 条 · 信息 46" 的冒号、数字必然对不上——用户反馈的
 * 「能像表格一样吗，现在对不齐」就是这个。换成自绘列表后，数字挤成四列定宽右
 * 对齐，读起来就是一张表。
 *
 * 分工：
 * - **扳机（收起态）**只显示当前来源的名字——具体多少条、多少警告在左侧级别
 *   按钮与标题徽标上，这里再写一遍既重复又撑宽控件（用户反馈第 4 条）；
 * - **候选列表**才是「切换之前先看行情」的地方：每个来源一行，行内四列数字。
 */
function OriginSelect({
  value,
  countsByOrigin,
  onChange,
}: {
  value: LogOriginFilter;
  countsByOrigin: Record<LogOriginFilter, LogLevelCounts>;
  onChange: (next: LogOriginFilter) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? "all")}>
      <SelectTrigger
        size="sm"
        aria-label="按来源筛选"
        title="按来源筛选：展开后每项都标出该类别的条数与本机上的信息 / 警告 / 错误"
        className="border-border-strong bg-canvas-deep text-ink-field h-8 rounded-lg text-[12px]"
      >
        {/* 只写来源名：具体多少条、多少警告在左侧级别按钮与标题徽标上，
            这里再报一遍既不增加信息量，又把本就不宽的行头再挤掉一块。 */}
        <SelectValue>
          {(selected) => ORIGIN_TEXT[asOriginFilter(selected)]}
        </SelectValue>
      </SelectTrigger>
      {/* 弹层必须盖在日志面板之上：面板遮罩走刻度表的 `modal` 档（见本文件底部
          overlayClass 的 z 参数），而 Select 的定位层若低于它——弹层照常画出来，却整块
          压在遮罩底下**收不到指针事件**。用户读到的现象就是「点了下拉看不到菜单」
          与「没法切换来源」，来源筛选因此形同失效（ISSUE #262）。
          层级给在定位层（positionerClassName）而不是 Popup：Popup 的 z 只在
          定位层建立的 stacking context 内部比较，改它越不出这一层。 */}
      {/* `w-(--anchor-width)` 会把弹层压到扳机那么宽，四列数字直接挤成一团；
          这里放开宽度，让弹层按内容（四个定宽列）撑开。
          注意 `w-auto` / `min-w-max` 的**级联顺序**：两者都比 `w-(--anchor-width)`
          后出现，因此最终生效的是内容宽度（这正是这里要的效果）；反过来若把
          `w-auto` 去掉，弹层会被压到扳机的 90px，四列数字挤成一团。 */}
      <SelectContent
        positionerClassName={LOG_PANEL_POPUP_Z_CLASS}
        /* 与扳机**底边**对齐（用户要求：「弹出下拉菜单的最上方和下拉按钮的
         * 最下方对齐即可」）。
         *
         * base-ui 的 `alignItemWithTrigger` 默认会把弹层挪去盖住扳机本身，
         * 于是头部在窗口顶端时弹层只能向上生长——实测直接顶到窗口最上方、
         * 盖住标题行的左侧（截图里就是这样）。两条一起改：
         *   - `alignItemWithTrigger={false}`：弹层不覆盖扳机，从它下面开始；
         *   - `collisionAvoidance={{ side: "none" }}`：撞到视口底部也不翻到
         *     上面去，需要时改为**滚动**弹层自身。
         * 于是弹层顶边恒等于扳机底边（sideOffset 4px），与窗口位置无关。 */
        alignItemWithTrigger={false}
        collisionAvoidance={{ side: "none" }}
        className="border-border-strong bg-card text-ink-field w-auto min-w-max rounded-lg border p-0"
      >
        {/* 列标题：把「数字是什么」写在一次，行内就不必每格重复「信息 / 警告」 */}
        <div
          aria-hidden
          className="border-border-strong text-ink-muted flex items-center gap-3 border-b px-2.5 py-1 text-[11px]"
        >
          <span className="w-16 shrink-0">来源</span>
          {ORIGIN_COLUMNS.map((column) => (
            <span key={column.key} className="w-14 shrink-0 text-right">
              {column.title}
            </span>
          ))}
        </div>
        <div className="p-1">
          {ORIGIN_LABELS.map((origin) => {
            const counts = countsByOrigin[origin];
            return (
              <SelectItem
                key={origin}
                value={origin}
                className="gap-0 py-1 pr-7 pl-1.5 text-[12px]"
              >
                <span className="flex items-center gap-3">
                  <span className="text-ink-bright w-16 shrink-0">
                    {ORIGIN_TEXT[origin]}
                  </span>
                  {ORIGIN_COLUMNS.map((column) => (
                    <CountColumn
                      key={column.key}
                      label={column.title}
                      value={counts[column.key]}
                      tone={column.tone}
                    />
                  ))}
                </span>
                {/* 纯文本版本，供屏幕阅读器与测试断言（自绘列是视觉产物） */}
                <span className="sr-only">{optionCountsText(counts)}</span>
              </SelectItem>
            );
          })}
        </div>
      </SelectContent>
    </Select>
  );
}

/**
 * 页脚的一行摘要：说清楚「现在看的是哪一段、还有多少」。
 *
 * 搜索词会收窄结果，所以它出现在数字里是**必要**的说明（否则「共 12 条」会被
 * 读成面板一共只有 12 条）；这里用「命中」而不是「匹配」，与计数徽标上的
 * 「筛选命中」是同一个口径。
 */
/* 面板的宽度档：默认 6xl —— 行是「时刻 + 级别 + 正文 + 来源」四列，比执行日志
 * 多一列，默认就该更宽；加宽档统一贴视线两边。宽度写 `w-*` 而不是 `max-w-*`
 * 的理由见 `~/components/ui/dialog-width` 的文件头（ISSUE #720：同族的两个
 * max-w 谁赢由 Tailwind 输出顺序决定，加宽按钮因此一直没生效）。 */
const PANEL_WIDTH = modalWidth("w-6xl");

function pageSummary(
  page: number,
  totalPages: number,
  pageSize: number,
  total: number,
  all: number,
  search: string,
): string {
  if (total === 0) return search.trim() ? "无筛选命中的日志" : "无匹配日志";
  const head = `第 ${page} / ${totalPages} 页 · 每页最多 ${pageSize} 条`;
  const tail = `${search.trim() ? "筛选命中" : "匹配"} ${total} 条 · 面板共保留 ${all} 条`;
  return `${head} · ${tail}`;
}

export function LogPanel() {
  const {
    filteredLogs,
    filter,
    origin,
    search,
    isOpen,
    counts,
    countsByOrigin,
    page,
    pageSize,
    bootId,
    autoScroll,
    anchorId,
    viewBaselineAfter,
  } = useLogPanel((state) => state.header);
  /* 计数一律看**当前来源**：「全部来源」下是全局数，选了某个来源就是该来源自己
   * 的数——级别按钮与来源下拉共用同一份，两边永远对得上（ISSUE #360）。 */
  const originCounts = countsByOrigin[origin ?? "all"] ?? countsByOrigin.all;
  const revision = useLogPanel((state) => state.revision);
  /* 「用户有没有主动要求回到最新」的生成号：它一变，贴底就升级为「一路追到
   * 最新」（见 log-store 的 followResetAt）。视图不自己去猜这件事，否则
   * store 与视图会各存一份贴底状态，出现「面板说不自动滚动、却仍在滚」。 */
  const followResetAt = useLogPanel((state) => state.followResetAt);
  const setFilter = useLogPanel((state) => state.setFilter);
  const setOrigin = useLogPanel((state) => state.setOrigin);
  const setSearch = useLogPanel((state) => state.setSearch);
  const setPage = useLogPanel((state) => state.setPage);
  const setFollowBottom = useLogPanel((state) => state.setFollowBottom);
  const storeJumpToLatest = useLogPanel((state) => state.jumpToLatest);
  const setIsOpen = useLogPanel((state) => state.setIsOpen);
  const clear = useLogPanel((state) => state.clear);
  const copyAll = useLogPanel((state) => state.copyAll);
  const download = useLogPanel((state) => state.download);

  const bodyRef = useRef<HTMLDivElement>(null);
  /* 滚动视口的**元素本身**进 state：下面「量视口」的 effect 必须等到这个元素
   * 真的挂上才量。改成弹窗基元（`ui/dialog`）之后，面板内容经 Portal 渲染，
   * 挂载比本组件晚一个提交 —— 只按 `[isOpen]` 触发的话，唯一的量测会发生在
   * ref 还是 null 的时候，之后再也没有第二次，虚拟化于是静默退化成「整页渲染」
   *（jsdom 里两条分支都渲染全部行，肉眼看不出来；只有量 DOM 节点数才发现）。
   * 依赖「元素出现了没有」而不是「面板开了没有」，量测才与挂载方式无关。 */
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  /* 贴底基线（= 用户已看过的最新一条在**页面里的序号**）。
   *
   * 面板贴着底看时只滚到这里：新日志在下面累积，不再每两秒把内容整体上移一次
   * ——那正是「刚选中一行就被刷新冲掉」的直接原因（ISSUE #262 复审）。
   * 基线在「打开面板 / 用户滚回底部 / 换页」时重取，用户点「回到最新」后
   * followResetAt 变化，贴底升级为一路追到最新。 */
  const baselineRef = useRef(0);
  /* 上一次贴底落在页面里的序号；仅用于「有新增才滚」的比较（不参与可见输出）。 */
  const appliedRef = useRef(-1);
  /* 上一次贴底**自己**写入的 `scrollTop`：据此判定「用户有没有接管滚动」
   * （见 `log-virtual` 的 `pinShouldYield`），是记账值，不进 state。 */
  const appliedTopRef = useRef(0);
  const [wrap, setWrap] = useState(true);
  const [wide, setWide] = useState(false);

  /* ── 虚拟窗口（ISSUE #609 八审：「切到 1000+ 的页签有明显卡顿」）────────
   *
   * 满页 2000 行一次性挂进 DOM 时，节点数约 1.5 万（每行还有若干分片 span），
   * 切页那一刻的布局成本就是用户感知到的卡顿。规范 02 §2.6 要求大列表虚拟
   * 滚动，这里只渲染视口内的几十行。
   *
   * 三个状态驱动的都是「**怎么算**」而不是「渲染什么」，因此都进 ref/state
   * 的轻量档：
   *   - `viewport`：滚动视口高度与可视宽度（软换行的容量用它算）；
   *   - `scrollTop`：滚动位置（`onScroll` 里直接读 `el.scrollTop`）；
   *   - 行位置表由 `pageLogs` + `wrap` 推出，随它们一起 memo。
   *
   * 为什么把 `scrollTop` 放进 state 而不是只读 ref：窗口区间是渲染结果的一部分
   * （不是副作用），放进 ref 会让「滚动 → 不重渲染 → 内容不更新」。每帧一次
   * `setState` 在 React 18 的批处理下只重渲染**列表容器**（行本身是 memo 的），
   * 实测远低于一帧预算。
   */
  const [viewport, setViewport] = useState({ height: 0, width: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  /* 分页在**过滤后的时间线**上做（时间倒序，第 1 页最新）。页码越界时钳回，
   * 并把 store 里的 page 一并归位，避免「看着第 1 页、state 里却是第 9 页」。 */
  const {
    entries: rawPageLogs,
    page: safePage,
    totalPages,
  } = useMemo(
    () => selectPageLogs(filteredLogs, page, pageSize),
    [filteredLogs, page, pageSize],
  );

  /* 第 1 页用**锚定**窗口（见 store 的 anchorId）：不锚定时窗口整体前移，每来一条
   * 新日志就重建一次首行节点——用户刚框住的文本随节点被卸载，选区当场消失
   * （「刚选择就刷新把我的选择弄没了」）。锚定后窗口原地不动，新行列在它之后；
   * 「后面还有多少条新的」由 `truncatedFromEnd` 直接给出（不再靠长度差，封顶时
   * 长度差恒为 0）。
   *
   * 其余页（历史页）本来就与「最新」无关，继续用固定窗口。 */
  const anchored = useMemo(
    () =>
      safePage === 1
        ? selectFirstPageWindow(filteredLogs, anchorId, pageSize)
        : null,
    [safePage, filteredLogs, anchorId, pageSize],
  );
  const visibleLogs = anchored ? anchored.entries : rawPageLogs;
  /* 当前窗口之后还有多少条更新的日志（锚定窗口直接给出；历史页则按页码算）。 */
  const unseenAfterView = anchored
    ? anchored.truncatedFromEnd
    : Math.max(0, filteredLogs.length - safePage * pageSize);

  /* 连续重复行折叠只影响显示（见 log-store 的 dedupeRepeats），不改时间线。 */
  const pageLogs = useMemo(() => dedupeRepeats(visibleLogs), [visibleLogs]);

  /* ── 行位置表 + 视口窗口 ────────────────────────────────────────────
   *
   * 位置表按**整页**算（单调前缀和）：`start[i]` 必须对得上前面所有行高之和，
   * 否则 `translateY` 与滚动条会各说各话。2000 行的乘法远低于一帧预算。
   *
   * `viewport.width` 为 0（首帧未量到 / jsdom 不做布局）时 `layoutRows` 只按
   * 显式换行估高——宁可少估，也不瞎估。 */
  const { rows, totalSize } = useMemo(
    () => layoutRows(pageLogs, wrap, wrap ? viewport.width : 0),
    [pageLogs, wrap, viewport.width],
  );
  const { height: scrollHeight } = scrollHeightOf(totalSize);
  /* 量不到视口高度（jsdom 不做布局 / 首帧测量之前）就**整页渲染**：虚拟化是
   * 性能优化，不该变成「内容看不见」的判据——取不到值时说「全都要」最安全，
   * 与改动前的行为一致。jsdom 里的单测正是走这一支。 */
  const rowWindow = useMemo(() => {
    if (viewport.height <= 0) {
      return { start: 0, end: pageLogs.length, entries: pageLogs };
    }
    const range = visibleRange(rows, scrollTop, viewport.height);
    return {
      start: range.start,
      end: range.end,
      entries: pageLogs.slice(range.start, range.end),
    };
  }, [rows, scrollTop, viewport.height, pageLogs]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage, setPage]);

  /* 换页时把滚动位置收回头部，并同步 `scrollTop` 状态。
   *
   * 虚拟化之前不需要这一步：整页都在 DOM 里，浏览器自己会把超出的 `scrollTop`
   * 钳回范围内。现在「渲染哪一段」由 `scrollTop` **算**出来，若它还停在上一页
   * 的纵深上（比如第 2 页滚到 30000px、翻到只有 8 行的第 3 页），算出的窗口会
   * 一路滑到末尾，用户看到的是「翻页后内容跑到一半、顶部空着」。
   *
   * `safePage` 是钳过边界的真实页码（见 selectPageLogs），据此判定「真的换了页」。 */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setScrollTop(0);
  }, [safePage]);

  /* ── 贴底：只追到「基线」，不再追着最新跑（ISSUE #262 复审）────────────
   *
   * 旧行为是「时间线一变就 scrollTop = scrollHeight」，而它**每两秒就成立一次**
   * （几乎每轮轮询都有新行），于是内容每隔两秒整体上移一次，用户刚框住的文本立刻
   * 被滚动冲掉。现在只在**贴着底**时把「已读水位」（基线）钉住，新行在下面累积，
   * 腾出的空间交给页脚的「有 N 条新的日志 · 回到最新」。任何一层成立都不动滚动
   * 位置：不在第 1 页（在看历史）/ 用户没贴着底（自己滚走了）/ 正在框选日志文本。
   *
   * 位置怎么算是纯逻辑（见 `log-virtual` 的贴底一组）；这里只读写 ref，不用 state
   * ——用 state 承载会让贴底本身触发重渲染，落进「滚动 → 重渲染 → 再滚动」的循环。
   */
  useEffect(() => {
    if (!isOpen) {
      baselineRef.current = 0;
      appliedRef.current = -1;
      return;
    }
    if (safePage !== 1 || !autoScroll) return;
    const el = bodyRef.current;
    if (!el) return;

    /* 用户点过「回到最新」→ 不再受基线约束，一路追到最新一页的底部。 */
    if (followResetAt > 0) {
      baselineRef.current = Math.max(0, visibleLogs.length - 1);
    }
    /* **正在框选就什么都别做**：拖动过程中浏览器会随滚动改锚点，滚动会打断框选
     * ——这正是「刚选中就被刷新弄没」的最后一环（前两环在 store：贴底基线）。 */
    if (selectionInsideLogs(currentSelection())) return;

    /* 目标行 + 「用户有没有接管滚动」的判据都在 `log-virtual` 的 `pinPlan`：
     * 用户自己滚到别处（例如滚到底看最新）时返回 `null`，本轮不动他的位置。 */
    const targetIndex = pinPlan({
      baseline: baselineRef.current,
      applied: appliedRef.current,
      bottomIndex: visibleLogs.length - 1,
      scrollTop: el.scrollTop,
      appliedTop: appliedTopRef.current,
    });
    if (targetIndex === null) return;
    /* 贴到目标行的下边缘（减去一个视口高）：位置一律取自**位置表**
     * `rows[targetIndex]`，那是 `translateY` 与滚动条共用的同一份口径。
     *
     * ⚠️ **不能用 `target.offsetTop` 量**。虚拟化之后行的 `offsetParent` 是那层
     * `translateY` 过的内层容器，`offsetTop` 给的是「它在**当前窗口**里的位置」
     * 而不是「它在整页内容里的位置」；拿它算 `scrollTop` 会把视口拉回窗口起点
     * ——用户滚到底就再也回不去底（这条 e2e 抓到的正是它）。
     *
     * 目标行在窗口外时它根本不在 DOM 里，这一支天然也走同一个算式：把目标行带进
     * 窗口，下一轮 effect 按同一张表对齐（两轮同解，不再有「真实节点」与「估算
     * 位置」两套坐标）。`rows[targetIndex]` 与 `pageLogs` 同源同长；真取不到就
     * 什么都不做，绝不能乱滚。 */
    const row = rows[targetIndex];
    if (!row) return;
    const next = pinScrollTop(
      { start: row.start, size: row.size },
      el.clientHeight,
    );
    el.scrollTop = next;
    appliedTopRef.current = next;
    appliedRef.current = targetIndex;
  }, [
    isOpen,
    autoScroll,
    safePage,
    revision,
    followResetAt,
    visibleLogs.length,
    rows,
  ]);

  /* 视口尺寸（滚动视口高度 + 可供正文使用的宽度）。
   *
   * 高度决定**渲染几行**；宽度决定**软换行估几行**（见 log-virtual 的
   * `countLines`）。两者都必须重新量：面板可以加宽（标题栏的「加宽」按钮）、
   * 窗口可以缩放、正文列还会随滚动条出现而变窄。
   *
   * 用 ResizeObserver 而不是 window 的 resize：加宽按钮改的是元素宽度，
   * 窗口尺寸一点没变。观测不到（jsdom / 老浏览器）时不额外退化——量出来恒为
   * 0 已经会让下面的窗口逻辑走「整页渲染」那一支，行为与改动前一致。 */
  useEffect(() => {
    const el = bodyEl;
    if (!el) return;
    /* 首次量测与后续量测走**同一条**路径：都从 `ResizeObserver` 的回调外部
       调一次 `measure`。`measure` 里的 setState 只在取值真的变了才落状态
       （见它自己的等值判断），因此这里不会「每次 effect 都触发一次渲染」。 */
    const measure = () => {
      const next = {
        height: el.clientHeight,
        width: el.clientWidth,
      };
      setViewport((prev) =>
        prev.height === next.height && prev.width === next.width ? prev : next,
      );
      setScrollTop(el.scrollTop);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bodyEl]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    /* 滚动位置是**渲染输入**（决定窗口取哪一段），因此进 state 而不是只留 ref：
     * 只读 ref 会出现「滚了但不重渲染、内容不更新」。 */
    setScrollTop(el.scrollTop);
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    /* 贴着底 = 用户要看最新，基线就取末条（面板打开时 `autoScroll` 已是 true，
     * 若再要求 `!autoScroll` 则「从顶部滚到底」永远进不来，基线停在 0，下一轮
     * 轮询会把用户按回顶部）。
     *
     * 这里**只重取基线**（水位锚点），不动 `appliedRef`：那个 ref 回答的是「贴底
     * 上一次落在哪一行」，只有贴底 effect 自己写过才算数（`pinPlan` 据它判「用户
     * 有没有接管滚动」）。把滚动事件也算成「已落位」，会让 `pinPlan` 把「贴底刚被
     * 重取基线」误读成「用户自己滚走了」，于是本轮一步都不动 —— 用户滚到底后贴底
     * 不再跟到页尾，又回到「滚不到底」。 */
    if (nearBottom) {
      baselineRef.current = Math.max(0, visibleLogs.length - 1);
    }
    setFollowBottom(nearBottom);
  };

  const shouldPin = selectShouldPinToLatest(safePage, autoScroll);
  const newLogCount = useLogPanel(
    useCallback(
      (state: LogPanelState) =>
        selectNewLogCount({
          unseenAfterView,
          baselineAfterView: viewBaselineAfter,
          page: state.page,
          autoScroll,
        }),
      [autoScroll, unseenAfterView, viewBaselineAfter],
    ),
  );

  const jumpToLatest = () => {
    storeJumpToLatest();
    setPage(1);
  };

  const total = filteredLogs.length;
  /* 「现在复制/下载的是哪一类」——与页脚的筛选摘要同口径，导出前一眼可见。 */
  const scopeLabel = [
    ORIGIN_TEXT[origin ?? "all"],
    FILTER_LABELS.find((item) => item.value === filter)?.label ?? "全部",
    search.trim() ? `搜索「${search.trim()}」` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (!isOpen) return null;

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给 `ui/dialog`：此前这里**既没接
     Esc、也没有遮罩点击关闭** —— 面板只能靠外壳的开关按钮关掉。层级仍由刻度表
     给出（`ui/dialog` 的遮罩取 `Z.modal`），面板内的弹层继续取 `Z.popup`
     （§16.2.5 的 `popup > modal` 判据不变）。 */
  return (
    <Dialog open onOpenChange={(next) => !next && setIsOpen(false)}>
      <DialogContent
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName={wide ? PANEL_WIDTH.wide : PANEL_WIDTH.base}
      >
        <div
          className={`border-border-strong bg-panel flex h-[85vh] flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/25 dark:shadow-black/60 ${wide ? PANEL_WIDTH.wide : PANEL_WIDTH.base}`}
        >
          {/* Header */}
          {/* 行头：宽窗口一行，窄窗口下筛选器整组折到第二行（判据是筛选器容器的
            `min-w-56`），所以行高用 `min-h`、允许内容把它撑高而不是钉死高度。 */}
          <div className="border-border-strong bg-surface-1 flex min-h-14 shrink-0 flex-wrap items-center gap-y-1.5 border-b px-4 py-2">
            <div className="flex shrink-0 items-center gap-2">
              <FileText
                size={16}
                className="shrink-0 text-violet-700 dark:text-violet-400"
              />
              {/* 标题不可换行：换行会把行头撑高、把下面的筛选器挤成竖排单字
                （窄窗口下实测就是这样）。宽度不够时宁可让别的元素让它。 */}
              <span className="text-ink-bright text-[15px] font-semibold whitespace-nowrap">
                应用日志
              </span>
              {/* 标题旁不复述任何计数：数字的唯一出口是右侧级别按钮（同一份
                `originCounts`），完整分类数（含信息）在各按钮的悬浮说明里。 */}
            </div>

            {/* Level filters：数字是**当前来源**下的计数，与右边来源下拉同口径。
              标签与数字**同行**（标签在左、计数在右）——这是本轮之前被否掉的一种
              排法，当时的问题是它**各占一份固有宽度**、不和别人分享空间：行头一挤
              就先把筛选器压到 32px、汉字只剩竖排的余地。
              现在筛选器整组 `flex-1`：它自己就是那块弹性空间，宽度随行头伸缩，
              每个按钮等分并在有富余时一起变宽（用户诉求：「全部/警告/错误这些挤
              在一起，可以占用大些空间」；「顶部还有较大空白区域」指的就是它们与
              搜索框之间那块被 `flex-1` 空白吸走的地方）。 */}
            {/* 这个容器同时承担两件事：
              1. **它自己就是那块弹性空间**——不再另设无名空白，五个按钮等分富余
                 宽度（用户诉求：「全部/警告/错误这些挤在一起，可以占用大些空间」）；
                 右侧的搜索 / 来源下拉 / 操作按钮也因此被顶到最右，不必再靠一个
                 单独的 `flex-1` 空白——多一个 `flex-1` 只会和它平分富余宽度，
                 于是「空白又回来了」。
              2. **`min-w-56` 是折行与否的判据**：可用宽度不足 224px 时它整组落到
                 第二行（`flex-wrap` 的换行单位就是这个容器）并吃掉整行宽度。
                 比「每个按钮各自 min-w 后硬挤」好在：无论多窄，标签都保持可读，
                 不会退化成只剩一列竖字。 */}
            <LogFilterBar originCounts={originCounts} />

            {/* 来源筛选贴最右（用户要求：中间让出来的宽度归左侧的类别与条数）。
              候选列表每项自带「条数 / 信息 / 警告 / 错误」四列——此前只有名字，
              用户必须先切过去才知道那边有没有问题（ISSUE #360）。 */}
            <OriginSelect
              value={origin ?? "all"}
              countsByOrigin={countsByOrigin}
              onChange={setOrigin}
            />

            {/* Actions */}
            <div className="flex items-center gap-1 pl-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setWrap((prev) => !prev)}
                title={wrap ? "折叠超长行" : "自动换行显示"}
                /* 选中态与级别按钮同一份：`bg-subtle` 在浅色主题下与行头底色同值。 */
                className={`rounded-md p-2 transition-colors ${
                  wrap
                    ? `${FILTER_SELECTED_STYLES} text-ink-bright`
                    : "text-ink-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                <Type size={16} />
              </Button>
              {/* title 写明范围：复制/下载的是**当前筛选下的全部日志**（跨所有页）。 */}
              {(
                [
                  { onClick: copyAll, label: "复制", Icon: Copy },
                  {
                    onClick: download,
                    label: "下载为文本文件",
                    Icon: Download,
                  },
                ] as const
              ).map(({ onClick, label, Icon }) => (
                <Button
                  key={label}
                  variant="ghost"
                  size="icon"
                  onClick={onClick}
                  title={`${label}当前筛选的全部日志（${scopeLabel} · ${total} 条）`}
                  aria-label={`${label}当前筛选的全部日志`}
                  className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
                >
                  <Icon size={16} />
                </Button>
              ))}
              {/* 服务端落盘版导出（见 SaveExportButton）。 */}
              <SaveExportButton
                label={origin ?? "all"}
                scopeLabel={scopeLabel}
                total={total}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={clear}
                title="清空面板"
                className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
              >
                <Trash2 size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setWide((w) => !w)}
                title={wide ? "收缩" : "加宽"}
                className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
              >
                {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                title="关闭 (Ctrl+Shift+L)"
                className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
              >
                <X size={16} />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div
            ref={(el) => {
              bodyRef.current = el;
              setBodyEl(el);
            }}
            onScroll={onScroll}
            className="custom-scrollbar bg-canvas-deep/60 flex-1 overflow-y-auto"
          >
            {pageLogs.length === 0 ? (
              <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
                <FileText size={32} strokeWidth={1.5} className="opacity-30" />
                {total === 0 ? "暂无匹配的日志" : "本页无内容"}
              </div>
            ) : (
              /* 虚拟窗口：外层撑出**估算总高**（滚动条长度与真实内容一致），
               内层 `translateY` 到当前窗口的起点——只挂视口内的行。 */
              <div
                style={{ height: `${scrollHeight}px` }}
                className="relative w-full"
              >
                <div
                  style={{
                    transform: `translateY(${rows[rowWindow.start]?.start ?? 0}px)`,
                  }}
                  className="absolute top-0 left-0 w-full"
                >
                  {/* `data-log-index`：这一行在**整页**里的绝对序号（不是它在
                    当前窗口里的第几个）。它同时是测试量「渲染了哪一段」的落点
                    （e2e 与 jsdom 单测都按它断言窗口位置），因此序号口径必须是
                    页内绝对的——窗口一变，同一个序号还得指着同一行。 */}
                  {rowWindow.entries.map((entry, offset) => {
                    const index = rowWindow.start + offset;
                    return (
                      <div key={entry.id} data-log-index={index}>
                        <LogRow
                          entry={entry}
                          wrap={wrap}
                          keyword={search}
                          /* 显式高度 = 估算高度：两者不同口径时误差会累积，
                           滚动位置与内容就错开了（见 log-virtual 的常量）。 */
                          style={{
                            height: `${rows[index]?.size ?? LOG_ROW_SINGLE}px`,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer：分页 + 「回到最新」出口。
            时间线不设总数上限（能往前翻完整段历史），**同时显示**多少条由
            每页 ≤ LOG_PAGE_SIZE 兜住，用户不会再被「两千条封顶」挡住视线。 */}
          <div className="border-border-strong bg-surface-1 text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
            <span className="flex items-center gap-2">
              <span>
                {pageSummary(
                  safePage,
                  totalPages,
                  pageSize,
                  total,
                  counts.all,
                  search,
                )}
              </span>
              {/* 服务端进程标识：用户报障时能说清「日志来自哪个应用服务进程」，
                也让面板在服务真重启后能自证（时间线已重置）。 */}
              {bootId && (
                <span
                  className="border-border-strong text-ink-muted shrink-0 rounded border px-1.5 py-px text-[11px]"
                  title={`应用服务进程标识：${bootId}（重启后会变化，面板据此重置时间线）`}
                >
                  服务 {bootId.split(":").slice(-2).join(":")}
                </span>
              )}
            </span>
            <span className="flex items-center gap-3">
              {shouldPin && (
                <Button
                  variant="primary-solid"
                  size="xs"
                  onClick={jumpToLatest}
                >
                  <ArrowDownToLine size={12} />
                  {newLogCount > 0
                    ? `有 ${newLogCount} 条新的日志 · 回到最新`
                    : "回到最新"}
                </Button>
              )}
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= totalPages}
                  title="更早的一页"
                  className="text-ink-soft hover:bg-subtle hover:text-ink rounded-md"
                >
                  <ChevronLeft size={14} />
                </Button>
                {/* 当前正看的是哪一段（来源 / 级别 / 搜索词），点任意一项即去掉
                  那一层筛选。此处用按钮而不是纯文本：页脚是「说出来我在看什么」
                  的位置，回滚动作本来就该在这儿，不必让用户跑回顶部找。 */}
                <span className="text-ink-soft flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setOrigin("all")}
                    disabled={!origin || origin === "all"}
                    title={
                      origin && origin !== "all" ? "去掉来源筛选" : undefined
                    }
                    className="enabled:hover:bg-subtle enabled:hover:text-ink rounded-md tabular-nums disabled:cursor-default"
                  >
                    {ORIGIN_TEXT[origin ?? "all"]}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setFilter("all")}
                    disabled={filter === "all"}
                    title={filter !== "all" ? "去掉级别筛选" : undefined}
                    className="enabled:hover:bg-subtle enabled:hover:text-ink rounded-md disabled:cursor-default"
                  >
                    {FILTER_LABELS.find((item) => item.value === filter)?.label}
                  </Button>
                  {search.trim() && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setSearch("")}
                      title="清空搜索"
                      className="hover:bg-subtle hover:text-ink max-w-40 truncate rounded-md"
                    >
                      {`搜索「${search.trim()}」`}
                    </Button>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage <= 1}
                  title="更新的一页"
                  className="text-ink-soft hover:bg-subtle hover:text-ink rounded-md"
                >
                  <ChevronRight size={14} />
                </Button>
              </span>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 取当前选区（浏览器里是 `window.getSelection()`）。
 *
 * 抽成函数是为了让上面的贴底 effect 能「取不到就说没有」：jsdom 没有
 * `getSelection`，返回 null 后 `selectionInsideLogs` 会给出 false，
 * 贴底行为与既有测试一致，不会因为多了一道判据而整体失效。
 */
function currentSelection() {
  if (typeof window === "undefined") return null;
  if (typeof window.getSelection !== "function") return null;
  return window.getSelection();
}
