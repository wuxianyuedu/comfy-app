"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useMemo, useRef, useState } from "react";

import { useElementBox } from "~/components/ui/use-element-box";

import { HistoryTaskCard } from "./HistoryTaskCard";
import type { TaskItem } from "./history-types";

/**
 * 历史卡片网格的行级虚拟化（队列/历史 11 FPS 排查的落地）：
 * 一页 100 张卡，每张挂缩略图 / TimeAgo / 多个按钮——轮询与模拟进度每次提交
 * 都让整网格陪跑。这里把「一个虚拟项 = 一行卡片」交给 useVirtualizer，
 * 只挂视口附近的几行；滚动锚取 DocumentFrame 的 `[data-document-scroll]`
 * （与 ProjectOutputs 同一形状），量测前（jsdom clientHeight 恒 0）退化为
 * 全量渲染，否则清单会变空白。
 *
 * 大列表不挂 useAutoAnimate：FLIP 要在每次列表变化时量测整网格的盒子，
 * 100 张卡时是主线程 Layout 的主要来源；小列表仍保留条目级过渡动画。
 */

const GAP_PX = 12;
const CARD_ROW_ESTIMATE_PX = 210;
/** 超过这个条数就不接 FLIP 观察器（规范 02 §2.7 的「大子树动 layout」边界）。 */
const ANIMATE_MAX_ITEMS = 30;
const ANIMATE_OPTIONS = {
  duration: 250,
  easing: "ease-out",
  disrespectUserMotionPreference: true,
} as const;

export type HistoryCardGridProps = {
  isRetrying: (id: string) => boolean;
  isRowBusy: (id: string) => boolean;
  items: Array<TaskItem>;
  onAddToLibrary: (task: TaskItem) => void;
  onCancel: (id: string) => void;
  onCopyForReprint: (task: TaskItem) => void;
  onOpenDetail: (id: string) => void;
  onOpenFolder: (task: TaskItem) => void;
  onOpenLog: (task: TaskItem) => void;
  onRemove: (id: string) => void;
  onRetry: (task: TaskItem) => void;
  progressMap: Record<string, number>;
};

/**
 * 列表项用 memo 包住：父级只在轮询 / 进度推进时重建 props，静止卡的 props
 *（task / 稳定回调 / 布尔）都按值相等，memo 才能真正挡住无效重渲染（§4.8）。
 */
export const HistoryVirtualCardGrid = memo(function HistoryVirtualCardGrid({
  isRetrying,
  isRowBusy,
  items,
  onAddToLibrary,
  onCancel,
  onCopyForReprint,
  onOpenDetail,
  onOpenFolder,
  onOpenLog,
  onRemove,
  onRetry,
  progressMap,
}: HistoryCardGridProps) {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [boxRef, box] = useElementBox();
  const [animateRef] = useAutoAnimate<HTMLDivElement>(ANIMATE_OPTIONS);
  const animate = items.length <= ANIMATE_MAX_ITEMS;

  const setListEl = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el;
      boxRef(el);
      setScrollEl(el?.closest<HTMLElement>("[data-document-scroll]") ?? null);
      /* 布局量测只在 ref 回调（挂载）时做一次，不在 render 期读 offsetTop ——
       * render 期读布局会强制同步回流，大列表每次轮询都付一次。 */
      setScrollMargin(el?.offsetTop ?? 0);
    },
    [boxRef],
  );
  /* 两个 ref 合成一个回调：大列表只量尺寸、不把 animateRef 挂上去，
   * FLIP 观察器就不会对整网格做布局量测。 */
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      setListEl(el);
      if (animate) {
        animateRef(el);
      }
    },
    [animate, animateRef, setListEl],
  );

  const width = box?.clientWidth ?? 0;
  /* 与 HistoryList 的 `lg:grid-cols-2` 同档：窄屏单列、宽屏两列。 */
  const cols = width >= 1024 ? 2 : 1;

  const rows = useMemo(() => {
    const out: Array<Array<TaskItem>> = [];
    for (let i = 0; i < items.length; i += cols) {
      out.push(items.slice(i, i + cols));
    }
    return out;
  }, [items, cols]);

  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => CARD_ROW_ESTIMATE_PX,
    overscan: 3,
    gap: GAP_PX,
    scrollMargin,
  });
  const measured = (scrollEl?.clientHeight ?? 0) > 0 && width > 0;

  const renderCard = (task: TaskItem) => (
    <HistoryTaskCard
      busy={isRowBusy(task.id)}
      key={task.id}
      onAddToLibrary={onAddToLibrary}
      onCancel={onCancel}
      onCopyForReprint={onCopyForReprint}
      onOpenDetail={onOpenDetail}
      onOpenFolder={onOpenFolder}
      onOpenLog={onOpenLog}
      onRemove={onRemove}
      onRetry={onRetry}
      progress={progressMap[task.id] ?? 0}
      retrying={isRetrying(task.id)}
      task={task}
    />
  );

  const gridStyle = {
    display: "grid",
    gap: GAP_PX,
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
  } as const;

  if (!measured) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" ref={setRefs}>
        {items.map(renderCard)}
      </div>
    );
  }

  return (
    <div
      className="w-full"
      ref={setRefs}
      role="list"
      style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
    >
      {virtualizer.getVirtualItems().map((vi) => {
        const row = rows[vi.index];
        if (row === undefined) {
          return null;
        }
        return (
          <div
            data-index={vi.index}
            key={row[0]?.id ?? vi.key}
            ref={virtualizer.measureElement}
            role="listitem"
            style={{
              ...gridStyle,
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {row.map(renderCard)}
          </div>
        );
      })}
    </div>
  );
});
