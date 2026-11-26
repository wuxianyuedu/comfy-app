"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useRef, useState } from "react";

import { QueueRowLine } from "./QueueMonitorParts";
import type { QueueRow } from "./queue-monitor-config";
import type { QueueTaskParamRow } from "./queue-task-params";

/**
 * 排队 / 最近结果两段的窗口化列表（队列页重渲染预算）：
 * 队列 700+ 条时视图只列前 50 条排队 + 8 条最近，但每次轮询与 1s 秒表都会
 * 让整段列表重挂载一遍 DOM。这里把滚动锚交给 DocumentFrame 的
 * `[data-document-scroll]`（与 ProjectOutputs 同一形状），只挂视口附近的几行；
 * 量测前（jsdom clientHeight 恒 0）退化成全量列表，避免空屏。
 *
 * 行组件是 memo 的：所有回调由 controller 提供稳定身份，逐行闭包放在行组件
 * 自己的 render 里，不再由父级每行现造（规范 04 §4.8）。
 */

const ROW_ESTIMATE_PX = 56;

export type QueueRowVirtualItem = { leading?: string; row: QueueRow };

type QueueRowVirtualListProps = {
  expandedId: string | null;
  isBusy: (id: string) => boolean;
  onCancel: (row: QueueRow) => void;
  onCopy: (row: QueueRow) => void;
  onMoveUp: (row: QueueRow) => void;
  onOpenFolder: (row: QueueRow) => void;
  onOpenLog: (row: QueueRow) => void;
  onToggleParams: (id: string) => void;
  paramRows: Array<QueueTaskParamRow>;
  paramsLoading: boolean;
  rows: Array<QueueRowVirtualItem>;
};

export const QueueRowVirtualList = memo(function QueueRowVirtualList({
  expandedId,
  isBusy,
  onCancel,
  onCopy,
  onMoveUp,
  onOpenFolder,
  onOpenLog,
  onToggleParams,
  paramRows,
  paramsLoading,
  rows,
}: QueueRowVirtualListProps) {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  const setListEl = useCallback((el: HTMLOListElement | null) => {
    listRef.current = el;
    setScrollEl(el?.closest<HTMLElement>("[data-document-scroll]") ?? null);
  }, []);

  /* ⚠️ 必须在 render 期读：ref 回调触发时布局还没定，量到的 offsetTop 往往
   * 是 0，之后不再更新会让 scrollMargin 与真实滚动容器错位，表现为列表顶部
   * 一大块空白、只露出最后一行。这点强制回流的代价远小于错位（#5132）。 */
  const scrollMargin = listRef.current?.offsetTop ?? 0;
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 6,
    scrollMargin,
  });
  const measured = (scrollEl?.clientHeight ?? 0) > 0;

  const renderRow = (item: QueueRowVirtualItem) => (
    <QueueRowLine
      isBusy={isBusy}
      key={item.row.id}
      leading={item.leading}
      onCancel={onCancel}
      onCopy={onCopy}
      onMoveUp={onMoveUp}
      onOpenFolder={onOpenFolder}
      onOpenLog={onOpenLog}
      onToggleParams={onToggleParams}
      paramRows={paramRows}
      paramsExpanded={expandedId === item.row.id}
      paramsLoading={expandedId === item.row.id && paramsLoading}
      row={item.row}
    />
  );

  if (!measured) {
    return (
      <ol className="border-border bg-card overflow-hidden rounded-2xl border" ref={setListEl}>
        {rows.map((item) => (
          <li className="border-border border-b px-4 py-3 last:border-b-0" key={item.row.id}>
            {renderRow(item)}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol
      className="border-border bg-card overflow-hidden rounded-2xl border"
      ref={setListEl}
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((vi) => {
        const item = rows[vi.index];
        if (item === undefined) {
          return null;
        }
        return (
          <li
            className={`border-border absolute top-0 left-0 w-full px-4 py-3 ${
              vi.index === rows.length - 1 ? "" : "border-b"
            }`}
            data-index={vi.index}
            key={item.row.id}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${vi.start}px)` }}
          >
            {renderRow(item)}
          </li>
        );
      })}
    </ol>
  );
});
