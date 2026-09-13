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
  CONSOLE_ORIGIN,
  dedupeRepeats,
  formatEntryForClipboard,
  selectFirstPageWindow,
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
  LOG_ROW_TEXT_ATTRIBUTE,
  TOKEN_CLASS,
  rowFragments,
  selectionInsideLogs,
  type RowToken,
} from "./log-row-style";

/**
 * 级别按钮上的计数数字。
 *
 * **定宽 + 右对齐 + 等宽数字**：四个按钮上的 `0 / 12 / 3 / 1822` 宽度不一，
 * 按钮再等分也读不齐。这里给它一个显式的 `w-[4ch]`——「文字 + 四位数字」是
 * 这一格的固定预算，所以**文本长度不再随内容变化**。
 *
 * 数字本身不再按级别染色（`text-gray-600` 固定）：级别色已由同一行左侧的
 * **标签文字**承担（「警告」黄、「错误」红），同一个含义不必写两遍，
 * 也避免两个色块挤在一个按钮里互相稀释。
 */
function CountChip({ value }: { value: number }) {
  return (
    <span className="w-[4ch] shrink-0 text-right text-[11px] text-gray-600 tabular-nums">
      {value}
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
const LEVEL_LABEL_STYLES: Record<LogFilter, string> = {
  all: "text-gray-100",
  debug: "text-gray-500 hover:text-gray-300",
  info: "text-cyan-300 hover:text-cyan-200",
  warn: "text-amber-300 hover:text-amber-200",
  error: "text-rose-300 hover:text-rose-200",
};

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
  CONSOLE_ORIGIN,
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

/**
 * 一行日志末尾的复制按钮。
 *
 * 为什么必须有它（用户反馈第 2 条）：「日志多了我想复制报错文本还是复制不了，
 * 我刚选中内容就刷走了」。此前唯一的出口是标题栏上的「复制**全部**日志」——
 * 用户要的是一行，拿到的却是 2000 行，还得自己在里面搜。
 *
 * 它也让「选区」这件事变得不重要：不必先框住文本（框到一半可能被新日志/滚动
 * 打断），点一下就拿走整行。
 *
 * 反馈是本地的、按行独立的：连点不会互相覆盖，也不需要全局 toast——按钮自己
 * 在 1.2s 内显示「已复制」，且**只在成功时**改口（写剪贴板失败时说「已复制」
 * 是撒谎，反而让用户把一次失败的复制当成成功）。
 */
function RowCopyButton({ entry }: { entry: LogEntry }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 卸载时清掉定时器：日志行会随翻页/锚定窗口被卸载，留着定时器等于在一个
   * 已卸载组件上 setState（React 会警告，且那一下点击的反馈没了意义）。 */
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const flash = (next: "done" | "failed") => {
    setState(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 1200);
  };

  const onCopy = async () => {
    const text = formatEntryForClipboard(entry);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(text);
      flash("done");
    } catch {
      flash("failed");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title={
        state === "done"
          ? "已复制本条日志"
          : state === "failed"
            ? "复制失败：剪贴板不可用，请手动选中复制"
            : "复制本条日志"
      }
      aria-label="复制本条日志"
      data-log-copy=""
      /* 悬停/聚焦才显形：日志是「长时间盯着看」的界面，一个常在的按钮列会
       * 在每行末尾多出一块常驻色块，把正文的右边界切碎。键盘 Tab 聚焦时同样
       * 显形（`focus-visible`），不然纯键盘用户点不到它。 */
      className={`shrink-0 self-center rounded p-1 transition-opacity ${
        state === "idle"
          ? "opacity-0 group-hover:opacity-100 hover:bg-white/8 hover:text-gray-200 focus-visible:opacity-100"
          : "opacity-100"
      } ${
        state === "done"
          ? "text-emerald-300"
          : state === "failed"
            ? "text-rose-300"
            : "text-gray-500"
      }`}
    >
      {state === "idle" ? (
        <Copy size={13} />
      ) : (
        <span className="text-[11px] whitespace-nowrap">
          {state === "done" ? "已复制" : "复制失败"}
        </span>
      )}
    </button>
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
    <div className="group flex items-start gap-2.5 border-b border-white/3 px-4 py-1 font-mono text-[13px] leading-snug hover:bg-white/2">
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
        /* 选区判定的落点：面板贴底前要知道「用户框选的是不是日志正文」，
         * 这个属性就是那件事的载体（见 selectionInsideLogs）。 */
        {...{ [LOG_ROW_TEXT_ATTRIBUTE]: "" }}
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
      {/* 复制按钮永远在**最后一列**：它是行的终点，位置固定用户才找得到；
          `self-center` 让它在多行（换行显示）的行里也贴住垂直中线。 */}
      <RowCopyButton entry={entry} />
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
  /* 贴底基线（= 用户已看过的最新一条在**页面里的序号**）。
   *
   * 面板贴着底看时只滚到这里：新日志在下面累积，不再每两秒把内容整体上移一次
   * ——那正是「刚选中一行就被刷新冲掉」的直接原因（ISSUE #262 复审）。
   * 基线在「打开面板 / 用户滚回底部 / 换页」时重取，用户点「回到最新」后
   * followResetAt 变化，贴底升级为一路追到最新。 */
  const baselineRef = useRef(0);
  /* 上一次贴底落在页面里的序号；仅用于「有新增才滚」的比较（不参与可见输出）。 */
  const appliedRef = useRef(-1);
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

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage, setPage]);

  /* ── 贴底：只追到「基线」，不再追着最新跑（ISSUE #262 复审）────────────
   *
   * 旧行为是「时间线一变就 scrollTop = scrollHeight」，配一条「用户是不是在底部」
   * 的判定。判据本身没错，错的是它**每两秒就成立一次**：日志上限 2000 条时几乎
   * 每轮轮询都有新行，于是内容每隔两秒整体上移一次，用户刚框住的文本立刻被滚动
   * 冲掉（甚至根本框不到）。
   *
   * 现在分三层，任何一层成立都不动滚动位置：
   *   1. 不在第 1 页（在看历史）——历史页的内容本来就不该变；
   *   2. 用户没贴着底（自己上滚了）——同上，回到底部才重新贴；
   *   3. **用户正在日志正文里框选文本**——按 `selectionInsideLogs` 判定。
   *
   * 贴底时也不再滚到最新，而是滚到「基线」：面板打开 / 用户滚回底部 / 换页那一刻
   * 已看过的最后一条。新行在下面累积，腾出的空间交给页脚的
   * 「有 N 条新的日志 · 回到最新」这个显式出口。
   *
   * 实现上**只在 effect 里读写 ref**：这些是「上一次贴到哪」的记账值，用 state
   * 承载会让贴底本身触发一次重渲染，正好落进「滚动 → 重渲染 → 再滚动」的循环。
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

    /* 贴底目标 = max(基线上一次落点, 已追到哪)，并钳到本页最后一条：
     * 保证新行一条条露出来（不跳空），又不会被后面的新行无限拖走。 */
    const bottomIndex = visibleLogs.length - 1;
    const targetIndex = Math.max(
      0,
      Math.min(baselineRef.current, bottomIndex),
      Math.min(appliedRef.current, bottomIndex),
    );
    const target = el.querySelector<HTMLElement>(
      `[data-log-index="${targetIndex}"]`,
    );
    if (!target) return;
    el.scrollTop = Math.max(
      0,
      target.offsetTop + target.offsetHeight - el.clientHeight,
    );
    appliedRef.current = targetIndex;
  }, [
    isOpen,
    autoScroll,
    safePage,
    revision,
    followResetAt,
    visibleLogs.length,
  ]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    /* 用户回到（或离开）底部：贴底基线跟着当前页的内容重取，从此他看的是
     * 「自己停下时那一段」，而不是被新日志推着走的最新一段。 */
    if (nearBottom && !autoScroll) {
      baselineRef.current = appliedRef.current = Math.max(
        0,
        visibleLogs.length - 1,
      );
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
        {/* 行头：宽窗口下是一行（标题 / 筛选器 / 空白 / 搜索 / 来源 / 操作），
            窄窗口下筛选器整组**折到第二行**（见筛选器容器的 `min-w`），
            因此行高用 `min-h`、允许内容把它撑高，而不是钉死一个固定高度。

            为什么必须能折行：筛选器五个按钮加标题、搜索、来源下拉、六个操作按钮
            的总宽在 700px 上下就超过可用宽度；此前只有「一起硬挤」一条路，挤到
            最后标题换行、搜索框缩成图标、筛选器只剩下一列竖字。折行是这类
            「控件数量固定、宽度不定」行头的标准解法。 */}
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-y-1.5 border-b border-white/8 bg-white/2 px-4 py-2">
          <div className="flex shrink-0 items-center gap-2">
            <FileText size={16} className="shrink-0 text-violet-400" />
            {/* 标题不可换行：换行会把行头撑高、把下面的筛选器挤成竖排单字
                （窄窗口下实测就是这样）。宽度不够时宁可让别的元素让它。 */}
            <span className="text-[15px] font-semibold whitespace-nowrap text-gray-100">
              应用日志
            </span>
            {/* 这里**不再**复述任何计数（ISSUE #262 五审）。
                它此前是一块灰底胶囊，写着「警告 n · 错误 n」——而这两个数在右边
                的级别按钮上已经各有一份（同一个 `originCounts`）。用户圈出的
                「警告/错误显示重复了，左侧那两个去掉」指的就是它：一项数据两处
                出现，还会把标题行本就紧张的横向空间挤掉。
                计数只保留在级别按钮上，颜色由那儿的文字承担（「警告」黄、
                「错误」红）；完整分类数（含信息）在各按钮的悬浮说明里。 */}
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
          <div className="ml-3 flex min-w-56 flex-1 basis-0 items-center gap-1">
            {FILTER_LABELS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                aria-pressed={filter === option.value}
                /* 横向预算 = 左右内边距 + 标签 + 数字。`min-w-fit` 取的是**内容
                 * 固有宽度**（不是容器宽度）：`min-w-0` 会让容器压到能忽略固有宽度、
                 * 于是「警告」被切成 `警…`——用户报的就是这个（ISSUE #262）。
                 *
                 * 不省略的代价是窄窗口下整组可能横向溢出，所以同步去掉
                 * `overflow-hidden`：它是 `text-overflow: ellipsis` 生效的前提之一，
                 * 留着它等于给省略号留后门。横向溢出由行头的 `flex-wrap`
                 * （容器 `min-w-56` 是折行判据）接住。 */
                className={`flex h-9 min-w-fit flex-1 basis-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] leading-none transition-colors ${
                  filter === option.value ? "bg-white/10" : "hover:bg-white/4"
                } ${LEVEL_LABEL_STYLES[option.value]}`}
                title={`当前来源的${option.label}：${originCounts[option.value]} 条（该来源共 ${originCounts.all} 条 · 警告 ${originCounts.warn} · 错误 ${originCounts.error}）`}
              >
                <span className="whitespace-nowrap">{option.label}</span>
                <CountChip value={originCounts[option.value]} />
              </button>
            ))}
          </div>

          {/* Search 紧跟在级别按钮之后（不再 `ml-auto`）。
              行头的稀有宽度应当优先给**类别与条数**：搜索框是偶尔才用一次的
              控件，却因为吃掉了 `ml-auto` 多出来的全部空间，把来源下拉一直顶在
              级别按钮旁边，两者之间空出一大片（用户截图的红框正是这块空白），
              而左侧那排四位数的计数反而最挤。现在下拉右移贴住搜索框，
              中间被让出来的宽度由 `flex-1` 的空白区吸收。 */}
          {/* 搜索框可收缩（`shrink` + `min-w`）：行头窄到放不下时它先让位，
              而不是去挤筛选器的标签。`w-56` 是它舒展时的宽度。 */}
          <div className="relative flex w-56 min-w-24 shrink items-center">
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

          {/* 来源筛选贴到最右侧（搜索框之后）。候选列表里每项自带
              「条数 / 信息 / 警告 / 错误」四列——此前只有名字，用户必须先切过去
              才知道那边有没有问题，切换后看到空列表就以为日志丢了（ISSUE #360）。
              位置放在最右是用户的直接要求：中间空出来的宽度归左侧的类别与条数。 */}
          <OriginSelect
            value={origin ?? "all"}
            countsByOrigin={countsByOrigin}
            onChange={setOrigin}
          />

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
              {/* `data-log-index`：贴底要知道「滚到哪一行」，而不是「滚到
                  最底下」——两者差的就是用户还没看的那批新日志。 */}
              {pageLogs.map((entry, index) => (
                <div key={entry.id} data-log-index={index}>
                  <LogRow entry={entry} wrap={wrap} keyword={search} />
                </div>
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
