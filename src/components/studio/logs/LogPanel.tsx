"use client";

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Maximize2,
  Minimize2,
  Search,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  dedupeRepeats,
  selectNewLogCount,
  selectPageLogs,
  selectShouldPinToLatest,
  type LogEntry,
  type LogFilter,
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
import { useLogPanel } from "./LogProvider";
import {
  LOG_PANEL_OVERLAY_Z_CLASS,
  LOG_PANEL_POPUP_Z_CLASS,
} from "./log-panel-layers";
import { overlayClass } from "~/lib/full-screen-layer";
import {
  LEVEL_BADGE_STYLES,
  LEVEL_TEXT_STYLES,
  TOKEN_CLASS,
  rowFragments,
  type RowToken,
} from "./log-row-style";

/**
 * 计数小徽标：一眼看出「这一类有多少警告、多少错误」。
 *
 * 干说数字不够——用户要的是「这里有没有问题」。所以 warn / error 非零时用
 * 对应级别色，零条目的 warn / error **不显示**（省掉一屏 `警告 0 错误 0` 的噪音），
 * 其余情况退化为灰色数字（`info 1026` 这种量级本身没有警示含义）。
 */
function CountChip({
  level,
  value,
}: {
  level: LogLevel | "all";
  value: number;
}) {
  const alarming = value > 0 && (level === "warn" || level === "error");
  const tone =
    value > 0 && level === "error"
      ? "text-rose-300"
      : value > 0 && level === "warn"
        ? "text-amber-300"
        : "text-gray-600";
  return (
    <span className={`text-[11px] tabular-nums ${tone}`}>
      {alarming ? `· ${value}` : value}
    </span>
  );
}

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
      ? "text-gray-600"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "error"
          ? "text-rose-300"
          : "text-gray-300";
  return (
    <span className={`w-14 shrink-0 text-right tabular-nums ${color}`}>
      {value > 0 ? value : "—"}
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

const FILTER_LABELS: { label: string; value: LogFilter }[] = [
  { label: "全部", value: "all" },
  { label: "调试", value: "debug" },
  { label: "信息", value: "info" },
  { label: "警告", value: "warn" },
  { label: "错误", value: "error" },
];

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
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const time = date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  if (!isSameDay(date, new Date())) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}-${day} ${time}`;
  }
  return time;
}

/* Per-message render cache: a parsed log line is immutable, so we cache the
 * produced fragment list by the raw message string.  This avoids re-running the
 * ANSI/token parser for every row on every parent re-render (search, filter,
 * scroll, new-log arrival) — the single biggest cost in the old panel.
 * Memory is bounded by RENDER_CACHE_MAX (full clear on overflow).  Dev note:
 * Fast Refresh re-executes this module on edit, so rule changes naturally
 * start with a fresh cache — no stale-entry purge needed. */
const FRAGMENT_CACHE = new Map<string, RowToken[]>();
const FRAGMENT_CACHE_MAX = 5000;

function fragmentsOf(text: string): RowToken[] {
  const hit = FRAGMENT_CACHE.get(text);
  if (hit) return hit;
  const out = rowFragments(text);
  if (FRAGMENT_CACHE.size >= FRAGMENT_CACHE_MAX) FRAGMENT_CACHE.clear();
  FRAGMENT_CACHE.set(text, out);
  return out;
}

function HighlightedText({ text, keyword }: { text: string; keyword: string }) {
  const fragments = fragmentsOf(text);
  const needle = keyword.trim().toLowerCase();
  return (
    <>
      {fragments.map((fragment, index) => {
        const className = fragment.style
          ? TOKEN_CLASS[fragment.style]
          : undefined;
        if (!needle) {
          return (
            <span key={index} className={className}>
              {fragment.text}
            </span>
          );
        }
        const lower = fragment.text.toLowerCase();
        const parts: React.ReactNode[] = [];
        let cursor = 0;
        let at = lower.indexOf(needle);
        let key = 0;
        while (at !== -1) {
          if (at > cursor) parts.push(fragment.text.slice(cursor, at));
          parts.push(
            <mark
              key={key++}
              className="rounded-sm bg-amber-400/30 px-0.5 text-amber-100"
            >
              {fragment.text.slice(at, at + needle.length)}
            </mark>,
          );
          cursor = at + needle.length;
          at = lower.indexOf(needle, cursor);
        }
        if (cursor < fragment.text.length)
          parts.push(fragment.text.slice(cursor));
        return (
          <span key={index} className={className}>
            {parts}
          </span>
        );
      })}
    </>
  );
}

const LogRow = memo(function LogRow({
  entry,
  wrap,
  keyword,
}: {
  entry: LogEntry;
  wrap: boolean;
  keyword: string;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-white/3 px-4 py-1 font-mono text-[13px] leading-snug hover:bg-white/2">
      <time
        dateTime={new Date(entry.time).toISOString()}
        className="shrink-0 text-gray-500 tabular-nums"
      >
        {formatTime(entry.time)}
      </time>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${LEVEL_BADGE_STYLES[entry.level]}`}
      >
        {entry.level}
      </span>
      <span
        className={`min-w-0 flex-1 ${
          wrap ? "break-words whitespace-pre-wrap" : "truncate"
        } ${LEVEL_TEXT_STYLES[entry.level]}`}
        title={!wrap ? entry.message : undefined}
      >
        <HighlightedText text={entry.message} keyword={keyword} />
      </span>
      {entry.location && (
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(entry.location!)
              .catch(() => undefined)
          }
          className="max-w-[28%] shrink-0 cursor-pointer truncate text-right text-[11px] text-gray-600 hover:text-gray-400"
          title={`${entry.location}（点击复制）`}
        >
          {entry.location}
        </button>
      )}
      {entry.origin ? (
        <span className="shrink-0 text-[11px] text-gray-600">
          {entry.origin}
        </span>
      ) : (
        entry.source !== "console" && (
          <span className="shrink-0 text-[11px] text-gray-600">
            {entry.source}
          </span>
        )
      )}
    </div>
  );
});

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
        className="h-8 rounded-lg border-white/6 bg-[#13131a] text-[12px] text-gray-300"
      >
        {/* 只写来源名：具体多少条、多少警告在左侧级别按钮与标题徽标上，
            这里再报一遍既不增加信息量，又把本就不宽的行头再挤掉一块。 */}
        <SelectValue>
          {(selected) => ORIGIN_TEXT[asOriginFilter(selected)]}
        </SelectValue>
      </SelectTrigger>
      {/* 弹层必须盖在日志面板之上：面板遮罩是 `z-99`（见本文件底部 overlayClass
          的 z 参数），而 Select 的定位层默认只有 `z-50`——弹层照常画出来，却整块
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
        className="w-auto min-w-max rounded-lg border border-white/8 bg-[#15141f] p-0 text-gray-300"
      >
        {/* 列标题：把「数字是什么」写在一次，行内就不必每格重复「信息 / 警告」 */}
        <div
          aria-hidden
          className="flex items-center gap-3 border-b border-white/6 px-2.5 py-1 text-[11px] text-gray-500"
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
                  <span className="w-16 shrink-0 text-gray-200">
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
function pageSummary(
  page: number,
  totalPages: number,
  pageSize: number,
  total: number,
  all: number,
  search: string,
): string {
  if (total === 0) return search.trim() ? "无筛选命中的日志" : "无匹配日志";
  const head = `第 ${page} / ${totalPages} 页 · ${pageSize} 条/页`;
  const tail = `${search.trim() ? "筛选命中" : "匹配"} ${total} 条 · 面板保留最近 ${all} 条`;
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
  } = useLogPanel((state) => state.header);
  /* 计数一律看**当前来源**：「全部来源」下是全局数，选了某个来源就是该来源自己
   * 的数——级别按钮与来源下拉共用同一份，两边永远对得上（ISSUE #360）。 */
  const originCounts = countsByOrigin[origin ?? "all"] ?? countsByOrigin.all;
  const revision = useLogPanel((state) => state.revision);
  const setFilter = useLogPanel((state) => state.setFilter);
  const setOrigin = useLogPanel((state) => state.setOrigin);
  const setSearch = useLogPanel((state) => state.setSearch);
  const setPage = useLogPanel((state) => state.setPage);
  const setIsOpen = useLogPanel((state) => state.setIsOpen);
  const clear = useLogPanel((state) => state.clear);
  const copyAll = useLogPanel((state) => state.copyAll);
  const download = useLogPanel((state) => state.download);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [wide, setWide] = useState(false);

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
  /* 连续重复行折叠只影响显示（见 log-store 的 dedupeRepeats），不改时间线。 */
  const pageLogs = useMemo(() => dedupeRepeats(rawPageLogs), [rawPageLogs]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage, setPage]);

  /* 新日志到达 → 第 1 页且用户停在底部时贴底。判据是 `revision`（时间线生成号）
   * 而不是「末条 seq」：按时刻排序后，迟到的旧时刻行会插进中间、末条不变。 */
  const prevRevisionRef = useRef(revision);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !isOpen) return;
    if (revision !== prevRevisionRef.current && safePage === 1 && autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
    prevRevisionRef.current = revision;
  }, [revision, isOpen, autoScroll, safePage]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAutoScroll(nearBottom);
  };

  const shouldPin = selectShouldPinToLatest(safePage, autoScroll);
  const newLogCount = useLogPanel(
    useCallback(
      (state: LogPanelState) =>
        selectNewLogCount({
          revision: state.revision,
          viewRevision: state.viewRevision,
          viewLength: state.viewLength,
          filteredLogs: state.filteredLogs,
          page: state.page,
          autoScroll,
        }),
      [autoScroll],
    ),
  );

  const jumpToLatest = () => {
    setAutoScroll(true);
    setPage(1);
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const total = filteredLogs.length;

  if (!isOpen) return null;

  return (
    <div
      className={overlayClass(
        "modal",
        `${LOG_PANEL_OVERLAY_Z_CLASS} flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm`,
      )}
    >
      <div
        className={`flex h-[85vh] w-full ${wide ? "max-w-[96vw]" : "max-w-6xl"} flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#12101c] shadow-2xl shadow-black/60`}
      >
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/8 bg-white/2 px-4">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-violet-400" />
            <span className="text-[15px] font-semibold text-gray-100">
              应用日志
            </span>
            {/* 不再在这里复述「来源 · 条数 · 警告 · 错误」：同一组数字已经在右边
                的来源下拉（当前来源）与左边的级别按钮上各有一份，第三份既不增加
                信息量，又把本该留给标题的横向空间挤掉——用户反馈的「红框中两部分
                重复了」就是这个（ISSUE #262）。
                这里只留在**下面几处都看不见**时才需要的那一条：当前来源下的
                警告 / 错误里有问题时给个徽标提醒，全为零则完全不渲染。 */}
            {originCounts.warn > 0 || originCounts.error > 0 ? (
              <span
                className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-gray-400"
                title={`当前来源「${ORIGIN_TEXT[origin ?? "all"]}」共 ${originCounts.all} 条 · 信息 ${originCounts.info} · 警告 ${originCounts.warn} · 错误 ${originCounts.error}`}
              >
                <span
                  className={`tabular-nums ${originCounts.warn > 0 ? "text-amber-300" : "text-gray-600"}`}
                >
                  {`警告 ${originCounts.warn}`}
                </span>
                <span
                  className={`tabular-nums ${originCounts.error > 0 ? "text-rose-300" : "text-gray-600"}`}
                >
                  {` · 错误 ${originCounts.error}`}
                </span>
              </span>
            ) : null}
          </div>

          {/* Level filters：数字是**当前来源**下的计数，与右边来源下拉同口径。
              标签与数字**分行**（标签在上、数字在下）——并排时中文单字标签与
              四位数字会各占一份宽度，横向挤到头行放不下，标题行的剩余空间本该
              留给自己，而不是留给筛选器（用户反馈：太挤，汉字要竖直才排得下）。 */}
          <div className="ml-2 flex shrink-0 items-center gap-0.5">
            {FILTER_LABELS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                aria-pressed={filter === option.value}
                className={`flex w-8 flex-col items-center rounded-md py-0.5 text-[12px] leading-tight transition-colors ${
                  filter === option.value
                    ? "bg-white/10 text-gray-100"
                    : "text-gray-500 hover:bg-white/4 hover:text-gray-300"
                }`}
                title={`当前来源的${option.label}：${originCounts[option.value]} 条（该来源共 ${originCounts.all} 条 · 警告 ${originCounts.warn} · 错误 ${originCounts.error}）`}
              >
                <span>{option.label}</span>
                <CountChip
                  level={option.value}
                  value={originCounts[option.value]}
                />
              </button>
            ))}
          </div>

          {/* 来源筛选：候选列表里每项自带「条数 / 信息 / 警告 / 错误」四列。
              此前只有名字，用户必须先切过去才知道那边有没有问题——切换后看到
              空列表就以为日志丢了（ISSUE #360）；列表改成四列对齐的自绘下拉，
              切换前扫一眼就是一张表。 */}
          <OriginSelect
            value={origin ?? "all"}
            countsByOrigin={countsByOrigin}
            onChange={setOrigin}
          />

          {/* Search */}
          <div className="relative ml-auto flex w-56 items-center">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 text-gray-600"
            />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索日志（支持命中高亮）..."
              className="h-8 w-full rounded-lg border border-white/6 bg-[#13131a] pr-7 pl-8 text-[13px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-gray-500 hover:text-gray-300"
              >
                ×
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 pl-2">
            <button
              type="button"
              onClick={() => setWrap((prev) => !prev)}
              title={wrap ? "折叠超长行" : "自动换行显示"}
              className={`rounded-md p-2 transition-colors ${
                wrap
                  ? "bg-white/8 text-gray-200"
                  : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
              }`}
            >
              <Type size={16} />
            </button>
            <button
              type="button"
              onClick={copyAll}
              title="复制全部日志"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              onClick={download}
              title="下载为文本文件"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              onClick={clear}
              title="清空面板"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
              onClick={() => setWide((w) => !w)}
              title={wide ? "收缩" : "加宽"}
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="关闭 (Ctrl+Shift+L)"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          onScroll={onScroll}
          className="custom-scrollbar flex-1 overflow-y-auto bg-[#0d0d14]/60"
        >
          {pageLogs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-gray-600">
              <FileText size={32} strokeWidth={1.5} className="opacity-30" />
              {total === 0 ? "暂无匹配的日志" : "本页无内容"}
            </div>
          ) : (
            <div className="flex flex-col">
              {pageLogs.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  wrap={wrap}
                  keyword={search}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer：分页 + 「回到最新」出口。
            面板保留最近 MAX_LOG_ENTRIES 条（内存上限，防止长跑吃满内存），
            但**显示**按 200 条/页翻，用户不会再被「两千条封顶」挡住视线。 */}
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/8 bg-white/2 px-4 text-[12px] text-gray-500">
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
                className="shrink-0 rounded border border-white/8 px-1.5 py-px text-[11px] text-gray-500"
                title={`应用服务进程标识：${bootId}（重启后会变化，面板据此重置时间线）`}
              >
                服务 {bootId.split(":").slice(-2).join(":")}
              </span>
            )}
          </span>
          <span className="flex items-center gap-3">
            {shouldPin && (
              <button
                type="button"
                onClick={jumpToLatest}
                className="flex items-center gap-1 rounded-md bg-violet-500/90 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-violet-500"
              >
                <ArrowDownToLine size={12} />
                {newLogCount > 0
                  ? `有 ${newLogCount} 条新的日志 · 回到最新`
                  : "回到最新"}
              </button>
            )}
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= totalPages}
                title="更早的一页"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              {/* 当前正看的是哪一段（来源 / 级别 / 搜索词），点任意一项即去掉
                  那一层筛选。此处用按钮而不是纯文本：页脚是「说出来我在看什么」
                  的位置，回滚动作本来就该在这儿，不必让用户跑回顶部找。 */}
              <span className="flex items-center gap-1 text-gray-400">
                <button
                  type="button"
                  onClick={() => setOrigin("all")}
                  disabled={!origin || origin === "all"}
                  title={
                    origin && origin !== "all" ? "去掉来源筛选" : undefined
                  }
                  className="rounded-md px-1.5 py-0.5 tabular-nums enabled:hover:bg-white/5 enabled:hover:text-gray-200 disabled:cursor-default"
                >
                  {ORIGIN_TEXT[origin ?? "all"]}
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  disabled={filter === "all"}
                  title={filter !== "all" ? "去掉级别筛选" : undefined}
                  className="rounded-md px-1.5 py-0.5 enabled:hover:bg-white/5 enabled:hover:text-gray-200 disabled:cursor-default"
                >
                  {FILTER_LABELS.find((item) => item.value === filter)?.label}
                </button>
                {search.trim() && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    title="清空搜索"
                    className="max-w-40 truncate rounded-md px-1.5 py-0.5 hover:bg-white/5 hover:text-gray-200"
                  >
                    {`搜索「${search.trim()}」`}
                  </button>
                )}
              </span>
              <button
                type="button"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                title="更新的一页"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
