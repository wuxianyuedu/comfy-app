"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLogPanel, type LogEntry, type LogLevel, type LogFilter } from "./log-provider";

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: "bg-gray-500/15 text-gray-400 border-gray-500/20",
  info: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  error: "bg-rose-500/15 text-rose-400 border-rose-500/20",
};

const FILTER_LABELS: { label: string; value: LogFilter }[] = [
  { label: "全部", value: "all" },
  { label: "调试", value: "debug" },
  { label: "信息", value: "info" },
  { label: "警告", value: "warn" },
  { label: "错误", value: "error" },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function LogRow({ entry }: { entry: LogEntry }) {
  const levelClass = LEVEL_STYLES[entry.level];
  return (
    <div className="flex gap-2 border-b border-white/[0.03] px-3 py-1 font-mono text-[11px] leading-relaxed hover:bg-white/[0.02]">
      <span className="shrink-0 text-gray-600">{formatTime(entry.time)}</span>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${levelClass}`}
      >
        {entry.level}
      </span>
      <span
        className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${
          entry.level === "error"
            ? "text-rose-300"
            : entry.level === "warn"
              ? "text-amber-300"
              : entry.level === "debug"
                ? "text-gray-400"
                : "text-gray-300"
        }`}
        title={entry.message}
      >
        {entry.message}
      </span>
      {entry.source !== "console" && (
        <span className="shrink-0 text-[10px] text-gray-600">{entry.source}</span>
      )}
    </div>
  );
}

export function LogPanel() {
  const {
    filteredLogs,
    filter,
    setFilter,
    search,
    setSearch,
    isOpen,
    setIsOpen,
    clear,
    copyAll,
    download,
    counts,
  } = useLogPanel();

  const bodyRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevCountRef = useRef(filteredLogs.length);

  // Auto-scroll to bottom when new logs arrive, unless user scrolled up.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !isOpen) return;
    if (filteredLogs.length > prevCountRef.current && autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = filteredLogs.length;
  }, [filteredLogs.length, isOpen, autoScroll]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAutoScroll(nearBottom);
  };

  const errorCount = useMemo(() => counts.error, [counts.error]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 left-0 right-0 z-[99] flex h-[340px] flex-col border-t border-white/[0.08] bg-[#0d0d14]/98 text-gray-300 shadow-2xl shadow-black/40 backdrop-blur-md">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3">
        <div className="flex items-center gap-1.5">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-violet-400"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <line x1="10" y1="9" x2="9" y2="9" />
          </svg>
          <span className="text-[13px] font-semibold text-gray-200">应用日志</span>
          {errorCount > 0 && (
            <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
              {errorCount} 错误
            </span>
          )}
        </div>

        {/* Level filters */}
        <div className="ml-4 flex items-center gap-1">
          {FILTER_LABELS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                filter === f.value
                  ? "bg-white/[0.10] text-gray-200"
                  : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
              }`}
              title={`${f.label} (${counts[f.value]})`}
            >
              {f.label}
              <span className="ml-1 text-[10px] text-gray-600">{counts[f.value]}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative ml-auto flex w-56 items-center">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="pointer-events-none absolute left-2 text-gray-600"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索日志..."
            className="h-7 w-full rounded-md border border-white/[0.06] bg-[#13131a] pl-7 pr-2 text-[11px] text-gray-300 placeholder:text-gray-600 outline-none focus:border-violet-500/40"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 text-gray-500 hover:text-gray-300"
            >
              ×
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 pl-2">
          <button
            type="button"
            onClick={copyAll}
            title="复制全部"
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={download}
            title="下载日志"
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={clear}
            title="清空"
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            title="关闭 (Ctrl+Shift+L)"
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        onScroll={onScroll}
        className="custom-scrollbar flex-1 overflow-y-auto"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-gray-600">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="opacity-30"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="9" y2="9" />
            </svg>
            暂无匹配的日志
          </div>
        ) : (
          filteredLogs.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              const el = bodyRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="absolute bottom-3 right-3 rounded-full bg-violet-500/90 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg hover:bg-violet-500"
          >
            恢复自动滚动
          </button>
        )}
      </div>

      {/* Footer / count */}
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/[0.06] bg-white/[0.015] px-3 text-[11px] text-gray-600">
        <span>
          显示 {filteredLogs.length} / 总计 {counts.all} 条
        </span>
        <span>自动保留最近 {2000} 条</span>
      </div>
    </div>
  );
}
