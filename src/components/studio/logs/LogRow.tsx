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

import React, { memo, useState } from "react";
import { Copy } from "lucide-react";
import { formatEntryForClipboard, type LogEntry } from "./log-store";
import { Button } from "~/components/ui/button";
import { copyText } from "~/lib/browser-io";
import { normalizeNeedle } from "~/lib/list-filter";
import { useFlashState } from "~/components/ui/use-flash-state";
import { formatTime } from "./log-format";
import {
  LEVEL_BADGE_STYLES,
  LEVEL_TEXT_STYLES,
  LOG_ROW_TEXT_ATTRIBUTE,
  TOKEN_CLASS,
  rowFragments,
  type RowToken,
} from "./log-row-style";

/* 逐消息渲染缓存：一条已解析的日志行是不可变的，所以我们按原始
 * 消息串缓存产出的片段列表。这避免了在父级每次重渲染时
 *（搜索、筛选、滚动、新日志到达）对每一行重跑
 * ANSI / token 解析器 —— 旧面板里最大的单项开销。
 * 内存由 RENDER_CACHE_MAX 限制（溢出时整体清空）。开发注记：
 * Fast Refresh 会在编辑时重执行本模块，所以规则变化天然
 * 从空缓存开始 —— 无需清理陈旧条目。 */
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
  /* 归一化走 `~/lib/list-filter`（规范 16 §16.2.4.16）：它与 `matchesSearch`
   * 必须同一口径 —— 命中判据折了小写而高亮没折，会出现「行被选中但字没高亮」。 */
  const needle = normalizeNeedle(keyword);
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
  const [outcome, setOutcome] = useState<"idle" | "done" | "failed">("idle");
  /* 亮起态与「到点复位、连点清旧定时器、卸载清定时器」由 hook 收口 ——
   * 此前这里自己持 `timerRef` + 自己 `clearTimeout`（全库两处这样写，
   * 另有四处裸 `setTimeout` 连卸载都不管）。日志行**会**随翻页/锚点窗口
   * 被卸载，所以这条不是洁癖：不清就是往已卸载组件上 setState。 */
  /* 本按钮的亮起时长：1.2s。比 `useFlashState` 的默认 1.5s 短 ——
   * 反馈就长在按钮自己身上（原地换字），日志行又是密集列表，
   * 「已复制」停留越久越像常驻标签。 */
  const flash = useFlashState(1200);

  const onCopy = async () => {
    const text = formatEntryForClipboard(entry);
    setOutcome((await copyText(text)) ? "done" : "failed");
    flash.flash();
  };

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => void onCopy()}
      title={
        outcome === "done"
          ? "已复制本条日志"
          : outcome === "failed"
            ? "复制失败：剪贴板不可用，请手动选中复制"
            : "复制本条日志"
      }
      aria-label="复制本条日志"
      data-log-copy=""
      /* 悬停/聚焦才显形：日志是「长时间盯着看」的界面，一个常在的按钮列会
       * 在每行末尾多出一块常驻色块，把正文的右边界切碎。键盘 Tab 聚焦时同样
       * 显形（`focus-visible`），不然纯键盘用户点不到它。 */
      className={`shrink-0 self-center rounded transition-opacity ${
        outcome === "idle"
          ? "hover:bg-subtle hover:text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          : "opacity-100"
      } ${
        outcome === "done"
          ? "text-success-strong"
          : outcome === "failed"
            ? "text-danger-strong"
            : "text-ink-muted"
      }`}
    >
      {outcome === "idle" ? (
        <Copy size={13} />
      ) : (
        <span className="text-[11px] whitespace-nowrap">
          {outcome === "done" ? "已复制" : "复制失败"}
        </span>
      )}
    </Button>
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
        <Button
          variant="ghost"
          onClick={() => {
            void copyText(entry.location!);
          }}
          className="text-ink-fainter hover:text-ink-soft h-auto max-w-[28%] shrink-0 cursor-pointer truncate rounded-none p-0 text-right text-[11px] font-normal whitespace-nowrap"
          title={`${entry.location}（点击复制）`}
        >
          {entry.location}
        </Button>
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
