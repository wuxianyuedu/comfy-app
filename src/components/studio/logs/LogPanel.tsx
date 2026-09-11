"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
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
import { useShallow } from "zustand/react/shallow";
import {
  dedupeRepeats,
  selectNewLogCount,
  selectPageLogs,
  selectShouldPinToLatest,
  type LogEntry,
  type LogFilter,
  type LogOriginFilter,
} from "./log-store";
import { useLogPanel } from "./LogProvider";
import { overlayClass } from "~/lib/full-screen-layer";
import {
  LEVEL_BADGE_STYLES,
  LEVEL_TEXT_STYLES,
  TOKEN_CLASS,
  rowFragments,
  type RowToken,
} from "./log-row-style";

const FILTER_LABELS: { label: string; value: LogFilter }[] = [
  { label: "全部", value: "all" },
  { label: "调试", value: "debug" },
  { label: "信息", value: "info" },
  { label: "警告", value: "warn" },
  { label: "错误", value: "error" },
];

/* 来源筛选（ISSUE #262）：启动日志与应用运行日志此前混在一屏，query 噪音把
 * 业务日志挤掉。分开看是最直接的「让日志有意义」手段。 */
const ORIGIN_LABELS: { label: string; value: LogOriginFilter }[] = [
  { label: "全部来源", value: "all" },
  { label: "应用运行", value: "app-runtime" },
  { label: "应用服务", value: "app" },
  { label: "启动", value: "dev" },
  { label: "启动器", value: "launcher" },
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

function HighlightedText({
  text,
  keyword,
}: {
  text: string;
  keyword: string;
}) {
  const fragments = fragmentsOf(text);
  const needle = keyword.trim().toLowerCase();
  return (
    <>
      {fragments.map((fragment, index) => {
        const className = fragment.style ? TOKEN_CLASS[fragment.style] : undefined;
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
        if (cursor < fragment.text.length) parts.push(fragment.text.slice(cursor));
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
        className="shrink-0 tabular-nums text-gray-500"
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
          onClick={() => void navigator.clipboard.writeText(entry.location!).catch(() => undefined)}
          className="max-w-[28%] shrink-0 cursor-pointer truncate text-right text-[11px] text-gray-600 hover:text-gray-400"
          title={`${entry.location}（点击复制）`}
        >
          {entry.location}
        </button>
      )}
      {entry.origin ? (
        <span className="shrink-0 text-[11px] text-gray-600">{entry.origin}</span>
      ) : (
        entry.source !== "console" && (
          <span className="shrink-0 text-[11px] text-gray-600">{entry.source}</span>
        )
      )}
    </div>
  );
});

const ORIGIN_TEXT: Record<string, string> = {
  all: "全部来源",
  "app-runtime": "应用运行",
  /** 应用服务自身输出（Next dev server 的 stdout/stderr 转录）。 */
  app: "应用服务",
  dev: "开发服务",
  launcher: "启动器",
};

/** 页脚的一行摘要：说清楚「现在看的是哪一段、还有多少」。 */
function pageSummary(
  page: number,
  totalPages: number,
  pageSize: number,
  total: number,
  all: number,
): string {
  if (total === 0) return "无匹配日志";
  const head = `第 ${page} / ${totalPages} 页 · ${pageSize} 条/页`;
  const tail = `匹配 ${total} 条 · 面板保留最近 ${all} 条`;
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
    page,
    pageSize,
    bootId,
  } = useLogPanel(
    useShallow((state) => ({
      filteredLogs: state.filteredLogs,
      filter: state.filter,
      origin: state.origin,
      search: state.search,
      isOpen: state.isOpen,
      counts: state.counts,
      page: state.page,
      pageSize: state.pageSize,
      bootId: state.bootId,
    })),
  );
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
  const { entries: rawPageLogs, page: safePage, totalPages } = useMemo(
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
    useShallow((state) =>
      selectNewLogCount({
        revision: state.revision,
        viewRevision: state.viewRevision,
        viewLength: state.viewLength,
        filteredLogs: state.filteredLogs,
        page: state.page,
        autoScroll,
      }),
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
    <div className={overlayClass("modal", "z-99 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm")}>
      <div className={`flex h-[85vh] w-full ${wide ? "max-w-[96vw]" : "max-w-6xl"} flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#12101c] shadow-2xl shadow-black/60`}>
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/8 bg-white/2 px-4">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-violet-400" />
            <span className="text-[15px] font-semibold text-gray-100">
              应用日志
            </span>
            {counts.error > 0 && (
              <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-medium text-rose-300">
                {counts.error} 错误
              </span>
            )}
          </div>

          {/* Level filters */}
          <div className="ml-2 flex items-center gap-1">
            {FILTER_LABELS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={`rounded-md px-2 py-1 text-[13px] transition-colors ${
                  filter === option.value
                    ? "bg-white/10 text-gray-100"
                    : "text-gray-500 hover:bg-white/4 hover:text-gray-300"
                }`}
                title={`${option.label} (${counts[option.value]})`}
              >
                {option.label}
                <span className="ml-1 text-[11px] text-gray-600">
                  {counts[option.value]}
                </span>
              </button>
            ))}
          </div>

          <select
            value={origin}
            onChange={(event) => setOrigin(event.target.value as LogOriginFilter)}
            title="按来源筛选：应用运行日志 / 启动日志"
            className="h-8 rounded-lg border border-white/6 bg-[#13131a] px-2 text-[12px] text-gray-300 outline-none focus:border-violet-500/40"
          >
            {ORIGIN_LABELS.map((option) => (
              <option key={option.value ?? "all"} value={option.value ?? "all"}>
                {option.label}
              </option>
            ))}
          </select>

          {/* Search */}
          <div className="relative ml-auto flex w-56 items-center">
            <Search size={14} className="pointer-events-none absolute left-2.5 text-gray-600" />
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
                <LogRow key={entry.id} entry={entry} wrap={wrap} keyword={search} />
              ))}
            </div>
          )}
        </div>

        {/* Footer：分页 + 「回到最新」出口。
            面板保留最近 MAX_LOG_ENTRIES 条（内存上限，防止长跑吃满内存），
            但**显示**按 200 条/页翻，用户不会再被「两千条封顶」挡住视线。 */}
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/8 bg-white/2 px-4 text-[12px] text-gray-500">
          <span className="flex items-center gap-2">
            <span>{pageSummary(safePage, totalPages, pageSize, total, counts.all)}</span>
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
              <span className="tabular-nums">{ORIGIN_TEXT[origin ?? "all"] ?? "全部来源"}</span>
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
