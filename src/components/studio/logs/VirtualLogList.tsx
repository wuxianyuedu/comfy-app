"use client";

/**
 * VirtualLogList —— 日志面板的**虚拟滚动容器**（视图组件，复用 `./log-virtual`
 * 的纯逻辑行高/窗口计算）。
 *
 * ── 为什么又一个虚拟列表组件（而非各写一遍）──────────────────────────────
 * `LogPanel` 已经用 `log-virtual` 把 2000 行日志虚拟化了（ISSUE #609）。但
 * `GlobalStepLogPanel` 与 `WorkflowRunLogModal` 仍把最多 300 行一次性挂进 DOM，
 * 每来一条日志就重渲染全部行（§2.6 大列表必须虚拟滚动）。此前的做法是在两处各
 * 抄一份「量视口 + 算窗口 + 贴底」——与 `use-scroll-follow` 收口前「4 处各写一遍
 * 贴底」同源的重复。这里把「虚拟日志列表」收成**唯一**组件，两处弹窗共用。
 *
 * ── 贴底（follow）为什么收在这里 ─────────────────────────────────────────
 * `use-scroll-follow` 的文件头明确写着它**不接管虚拟化面板的贴底**：虚拟化后
 * 「滚到哪一行」靠位置表算（`log-virtual` 的 `pinPlan`/`pinScrollTop`），而这里
 * 的模型更简单——日志列表只「追到底」，且贴底必须**同步 `scrollTop` 状态**（否则
 * 窗口不重算、内容不更新）。因此本组件内联了「跟随底部」的最小语义（阈值复用
 * `use-scroll-follow` 导出的 `NEAR_BOTTOM_PX`），而不是把 `scrollTop` 交给外部。
 *
 * ── 量不到视口（jsdom / 首帧）走整页渲染 ─────────────────────────────────
 * 虚拟化是性能优化，不该变成「内容看不见」：取不到视口高度时 `rowWindow` 直接返回
 * 全部条目，与改动前行为一致（LogPanel 同款兜底）。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useElementBox } from "~/components/ui/use-element-box";
import { NEAR_BOTTOM_PX } from "~/components/ui/use-scroll-follow";
import {
  layoutRows,
  LOG_ROW_SINGLE,
  scrollHeightOf,
  visibleRange,
} from "./log-virtual";

/** 渲染某一条日志行的回调：`entry` 是原始条目，`index` 是它在 `entries` 里的
 * **绝对下标**（同一行在窗口滑动后下标不变，便于稳定 key 与测试断言）。 */
export type RenderLogRow<T> = (entry: T, index: number) => ReactNode;

export interface VirtualLogListProps<T> {
  /** 全部（已裁剪 / 已过滤）的日志条目；本组件只渲染视口内的那一小段。 */
  entries: readonly T[];
  /** 取用于折行估高的文本（行高估算依赖它；与 `LogPanel` 的 `entry.message` 同义）。 */
  getMessage: (entry: T) => string;
  /** 稳定 id（可选）：展开 / 单行特判用；缺省时按绝对下标。 */
  getId?: (entry: T) => string | undefined;
  /** 渲染单行。 */
  renderRow: RenderLogRow<T>;
  /** 折行估高（默认 true，与 `LogPanel` 一致：`wrap-break-word whitespace-pre-wrap`）。 */
  wrap?: boolean;
  /** 受控的「跟随底部」态；不给则非受控，组件自持。 */
  following?: boolean;
  /** 受控模式下跟随态变化回调（用户上滚 → `false`；点回「自动滚动」→ `true`）。 */
  onFollowingChange?: (following: boolean) => void;
  /** 「内容变了」的依赖值：变了就在跟随态下重新贴底。由调用处给（条数 / 筛选）。 */
  watch?: unknown;
  /** 列表之前、同处滚动容器内的静态内容（如验证错误 / 运行错误横幅）。 */
  topSlot?: ReactNode;
  /** 条目为空时展示的内容（通常是一个居中占位）。 */
  emptySlot?: ReactNode;
  className?: string;
}

export function VirtualLogList<T>({
  entries,
  getMessage,
  getId,
  renderRow,
  wrap = true,
  following: controlled,
  onFollowingChange,
  watch,
  topSlot,
  emptySlot,
  className,
}: VirtualLogListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [boxRef, box] = useElementBox();
  const [scrollTop, setScrollTop] = useState(0);
  const [internalFollowing, setInternalFollowing] = useState(true);
  const following = controlled ?? internalFollowing;

  /* 跟随态与回调进 ref：onScroll 里要立刻比较（事件回调里读 state 可能是旧批次值），
   * 且它们不该进任何依赖数组（与 `use-scroll-follow` 同款判据）。 */
  const followingRef = useRef(following);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);
  const notifyRef = useRef(onFollowingChange);
  useEffect(() => {
    notifyRef.current = onFollowingChange;
  }, [onFollowingChange]);

  const viewport = {
    height: box?.clientHeight ?? 0,
    width: box?.clientWidth ?? 0,
  };

  /* 整页行位置表（单调前缀和）：`start[i]` 必须对上前面所有行高之和，否则
   * `translateY` 与滚动条会各说各话。300 行乘法远低于一帧预算。 */
  const { rows, totalSize } = useMemo(
    () =>
      layoutRows(
        entries.map((entry) => ({
          message: getMessage(entry),
          id: getId?.(entry),
        })),
        wrap,
        wrap ? viewport.width : 0,
      ),
    [entries, getMessage, getId, wrap, viewport.width],
  );
  const { height: scrollHeight } = scrollHeightOf(totalSize);

  /* 视口量不到（jsdom / 首帧之前）就**整页渲染**：虚拟化是优化，不该让内容看不见。 */
  const rowWindow = useMemo(() => {
    if (viewport.height <= 0) {
      return { start: 0, end: entries.length, entries };
    }
    const range = visibleRange(rows, scrollTop, viewport.height);
    return {
      start: range.start,
      end: range.end,
      entries: entries.slice(range.start, range.end),
    };
  }, [rows, scrollTop, viewport.height, entries]);

  /* 贴底：跟随态下「内容变了」就滚到底。这里**同步 `scrollTop` 状态**而不是只动
   * DOM——后者不触发窗口重算（虚拟化前无所谓，现在窗口是 `scrollTop` 算出来的）。
   * 不依赖 scroll 事件触发，jsdom 里也能正确落位。 */
  useEffect(() => {
    if (!following) return;
    const el = containerRef.current;
    if (!el) return;
    const next = el.scrollHeight;
    el.scrollTop = next;
    setScrollTop(next);
  }, [following, watch]);

  const setFollowing = useCallback(
    (next: boolean) => {
      if (followingRef.current === next) return;
      followingRef.current = next;
      if (controlled === undefined) setInternalFollowing(next);
      notifyRef.current?.(next);
    },
    [controlled],
  );

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    /* 滚动位置是渲染输入（决定窗口取哪一段），因此进 state 而非只留 ref。 */
    setScrollTop(el.scrollTop);
    /* 「用户有没有接管滚动」：离底超过阈值就退出跟随，给出可见出口（自动滚动
     * 开关会相应取消勾选）。阈值复用 `use-scroll-follow` 的唯一定义。 */
    setFollowing(
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX,
    );
  }, [setFollowing]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        boxRef(el);
        /* 测量回调里同步一次滚动位置（与 `LogPanel` 同款接线）：面板加宽会让换行
         * 数变化、进而改变滚动范围，这里在外部系统通知里同步，不靠 effect setState。 */
        setScrollTop(el?.scrollTop ?? 0);
      }}
      onScroll={onScroll}
      className={`custom-scrollbar flex-1 overflow-y-auto ${className ?? ""}`}
    >
      {topSlot}
      {entries.length === 0 ? (
        emptySlot
      ) : (
        /* 外层撑出估算总高（滚动条长度与真实内容一致），内层 `translateY` 到当前
         * 窗口起点——只挂视口内的几十行。 */
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
            {rowWindow.entries.map((entry, offset) => {
              const index = rowWindow.start + offset;
              return (
                <div
                  key={`log-${index}`}
                  style={{ height: `${rows[index]?.size ?? LOG_ROW_SINGLE}px` }}
                >
                  {renderRow(entry, index)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
