"use client";

/**
 * 日志行的渲染层（从 `LogPanel.tsx` 拆出）。
 *
 * 拆分的理由是**文件行数**（规范 §12.6 的 900 行棘轮）：面板本体已经同时
 * 承担「筛选 / 分页 / 虚拟滚动 / 锚定」与「怎么画一行」两件事，而后者是完全
 * 自洽的一块 —— 行内分片缓存、关键词高亮、行级复制按钮都只被 `LogRow` 使用，
 * 与面板状态没有耦合。拆开之后两边的改动面互不牵连：调行内配色不必再进
 * 一个 1200+ 行的文件里定位。
 *
 * 契约（面板侧依赖的，拆走后不许改）：
 *   `LogRow` 的入参（entry / wrap / keyword / style）与 `data-log-*` 标记；
 *   换行与行高口径必须与 `log-virtual` 的 `LOG_ROW_SINGLE` / `LOG_ROW_LINE`
 *   一致（那个模块的注释指向的就是这里）。
 */

import React, { memo, useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { formatEntryForClipboard, type LogEntry } from "./log-store";
import { formatTime } from "./log-format";
import {
  LEVEL_BADGE_STYLES,
  LEVEL_TEXT_STYLES,
  LOG_ROW_TEXT_ATTRIBUTE,
  TOKEN_CLASS,
  rowFragments,
  type RowToken,
} from "./log-row-style";

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
              className="rounded-sm bg-amber-400/30 px-0.5 text-amber-900 dark:text-amber-100"
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
          ? "hover:bg-subtle hover:text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          : "opacity-100"
      } ${
        state === "done"
          ? "text-emerald-600 dark:text-emerald-300"
          : state === "failed"
            ? "text-rose-600 dark:text-rose-300"
            : "text-ink-muted"
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

/**
 * 一行日志。
 *
 * `height` 由**虚拟窗口**给出（`log-virtual` 的估算高度），这里写成内联样式：
 * 估算与 `leading-snug` 的实际行高必须同口径，否则累计误差会让滚动位置与
 * 内容错开（行高常量见 `LOG_ROW_SINGLE` / `LOG_ROW_LINE`）。
 *
 * 同时 `overflow-hidden`：高度被钉死之后，内容若比估算的高就会溢到下一行上，
 * 把两行叠在一起（不换行时尤其明显）。
 */
export const LogRow = memo(function LogRow({
  entry,
  wrap,
  keyword,
  style,
}: {
  entry: LogEntry;
  wrap: boolean;
  keyword: string;
  style: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className="border-border-subtle hover:bg-subtle/60 group flex items-start gap-2.5 overflow-hidden border-b px-4 py-1 font-mono text-[13px] leading-snug"
    >
      <time
        dateTime={new Date(entry.time).toISOString()}
        className="text-ink-muted shrink-0 tabular-nums"
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
          className="text-ink-fainter hover:text-ink-soft max-w-[28%] shrink-0 cursor-pointer truncate text-right text-[11px]"
          title={`${entry.location}（点击复制）`}
        >
          {entry.location}
        </button>
      )}
      {entry.origin ? (
        <span className="text-ink-fainter shrink-0 text-[11px]">
          {entry.origin}
        </span>
      ) : (
        entry.source !== "console" && (
          <span className="text-ink-fainter shrink-0 text-[11px]">
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
