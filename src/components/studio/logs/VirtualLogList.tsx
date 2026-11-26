"use client";

/**
 * VirtualLogList —— 日志面板的**虚拟滚动容器**（复用 `./log-virtual` 的纯逻辑行高/窗口计算）。
 * `LogPanel` 已虚拟化（ISSUE #609），但两个弹窗仍把最多 300 行一次性挂进 DOM、每来一条就重渲染
 * 全部行（§2.6）；这里收成唯一组件。贴底也收在这里：虚拟化后必须**同步 `scrollTop` 状态**，
 * 因此内联「跟随底部」的最小语义（阈值复用 `NEAR_BOTTOM_PX`）；量不到视口时走整页渲染。 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onNextFrame, type CancelNextFrame } from "~/lib/next-frame";
import { useElementBox } from "~/components/ui/use-element-box";
import { NEAR_BOTTOM_PX } from "~/components/ui/use-scroll-follow";
import {
  layoutRows,
  LOG_MESSAGE_OVERHEAD,
  LOG_ROW_SINGLE,
  scrollHeightOf,
  visibleRange,
} from "./log-virtual";

/** 渲染某一条日志行的回调：`entry` 是原始条目，`index` 是它在 `entries` 里的
 * **绝对下标**（同一行在窗口滑动后下标不变，便于稳定 key 与测试断言）。 */
export type RenderLogRow<T> = (entry: T, index: number) => ReactNode;

export type VirtualLogListProps<T> = {
  className?: string;
  /** 条目为空时展示的内容（通常是一个居中占位）。 */
  emptySlot?: ReactNode;
  /** 全部（已裁剪 / 已过滤）的日志条目；本组件只渲染视口内的那一小段。 */
  entries: ReadonlyArray<T>;
  /** 受控的「跟随底部」态；不给则非受控，组件自持。 */
  following?: boolean;
  /** 稳定 id（可选）：展开 / 单行特判用；缺省时按绝对下标。 */
  getId?: (entry: T) => string | undefined;
  /** 取用于折行估高的文本（行高估算依赖它；与 `LogPanel` 的 `entry.message` 同义）。 */
  getMessage: (entry: T) => string;
  /** 受控模式下跟随态变化回调（用户上滚 → `false`；点回「自动滚动」→ `true`）。 */
  onFollowingChange?: (following: boolean) => void;
  /** 渲染单行。 */
  renderRow: RenderLogRow<T>;
  /** 列表之前、同处滚动容器内的静态内容（如验证错误 / 运行错误横幅）。 */
  topSlot?: ReactNode;
  /** 「内容变了」的依赖值：变了就在跟随态下重新贴底。由调用处给（条数 / 筛选）。 */
  watch?: unknown;
  /** 折行估高（默认 true，与 `LogPanel` 一致：`wrap-break-word whitespace-pre-wrap`）。 */
  wrap?: boolean;
};

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

  /* 实测高度校正表：估算的字符宽度系数只能取均值，临界长消息会差出一行 ——
   * 行盒用 minHeight 渲染、内容撑开后在行盒的 ref 回调里实测回填，位置表随之
   * 修正，多行消息不再被固定行高截断、与后一行重叠（ISSUE #4618）。键带上面板
   * 宽度：同一消息在不同宽度下折行数不同，宽度变了旧实测自然失效（不用再开
   * 一个 effect 去清）。 */
  const [heightOverrides, setHeightOverrides] = useState<ReadonlyMap<string, number>>(new Map());
  const heightOf = useCallback(
    (message: string) => heightOverrides.get(`${viewport.width}:${message}`),
    [heightOverrides, viewport.width],
  );

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
        /* 与 `LogPanel` 同一口径：从面板宽里扣掉时刻 / 级别徽标 / 来源等
         * 非正文列的固定开销，再估软换行 —— 直接拿整宽会低估行数（ISSUE #4618）。 */
        wrap ? Math.max(200, viewport.width - LOG_MESSAGE_OVERHEAD) : 0,
        { heightOf },
      ),
    [entries, getMessage, getId, wrap, viewport.width, heightOf],
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
    if (!following) {
      return;
    }
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const next = el.scrollHeight;
    el.scrollTop = next;
    setScrollTop(next);
  }, [following, watch]);

  const setFollowing = useCallback(
    (next: boolean) => {
      if (followingRef.current === next) {
        return;
      }
      followingRef.current = next;
      if (controlled === undefined) {
        setInternalFollowing(next);
      }
      notifyRef.current?.(next);
    },
    [controlled],
  );

  /* 滚动事件一帧可能来好几次；每次都 setState 会让窗口重算多次。经
   * `onNextFrame` 收敛成一帧一次（唯一出口，带取消句柄），并在卸载时取消。 */
  const scrollFrame = useRef<CancelNextFrame | null>(null);
  useEffect(() => () => scrollFrame.current?.(), []);
  const onScroll = useCallback(() => {
    if (scrollFrame.current !== null) {
      return;
    }
    scrollFrame.current = onNextFrame(() => {
      scrollFrame.current = null;
      const el = containerRef.current;
      if (!el) {
        return;
      }
      /* 滚动位置是渲染输入（决定窗口取哪一段），因此进 state 而非只留 ref。 */
      setScrollTop(el.scrollTop);
      /* 「用户有没有接管滚动」：离底超过阈值就退出跟随，给出可见出口（自动滚动
         开关会相应取消勾选）。阈值复用 `use-scroll-follow` 的唯一定义。 */
      setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
    });
  }, [setFollowing]);

  /* 实测校正：行盒只有 minHeight（内容撑开用），所以要量**内容**而不是行盒 ——
   * 量行盒 offsetHeight 永远 >= minHeight，内容比估算矮时量不到，位置表就一直
   * 偏大、多出的那一行显示成空白（ISSUE #5035，#4715 在 LogPanel 已修、这里漏了）。
   * 双向采纳：比估算高撑开、比估算矮收窄，下限钳在单行档（layoutRows 的 heightOf
   * 出口负责）。在 ref 回调里做，不走 effect setState；实测 == 记录值后不再写入，
   * 循环自然收敛。jsdom 里 offsetHeight 恒 0，不触发。
   *
   * 卡顿侧（#5035）：回调身份必须稳定 —— 日志每来一帧 entries / rows 都换引用，
   * 若它们是回调依赖，measureRow 会重建、所有可见行的 ref 随之重挂去读
   * offsetHeight（强制同步布局）。这里把消息与估算高度随行盒一起写进 data-* 属性，
   * 回调从 el.dataset 读，不闭包捕获任何每帧变化的数据，依赖只剩 viewport.width
   * （校正表的 key 带宽度）。既无 ref 时序问题，也不在渲染期读 ref。 */
  const measureRow = useCallback(
    (el: HTMLElement | null) => {
      if (el === null) {
        return;
      }
      const message = el.dataset.logMessage ?? "";
      const estimated = Number(el.dataset.logEstimated ?? 0);
      const content = el.firstElementChild;
      const actual = content instanceof HTMLElement ? content.offsetHeight : 0;
      if (actual <= 0 || message === "") {
        return;
      }
      const key = `${viewport.width}:${message}`;
      if (Math.abs(actual - estimated) <= 1) {
        return;
      }
      /* 与 LogPanel 同款：在 updater 之外构造新 Map（updater-purity 判据禁止在
       * 函数式 updater 内调用 Map.set 这类副作用）。heightOverrides 从闭包读，
       * 这里只在挂载/重测时调用，多个 ref 同帧先后触发也不会互相覆盖。 */
      if (heightOverrides.get(key) === actual) {
        return;
      }
      const next = new Map(heightOverrides);
      next.set(key, actual);
      setHeightOverrides(next);
    },
    [viewport.width, heightOverrides],
  );

  return (
    <div
      className={`custom-scrollbar flex-1 overflow-y-auto ${className ?? ""}`}
      onScroll={onScroll}
      ref={(el) => {
        containerRef.current = el;
        boxRef(el);
        /* 测量回调里同步一次滚动位置（与 `LogPanel` 同款接线）：面板加宽会让换行
         * 数变化、进而改变滚动范围，这里在外部系统通知里同步，不靠 effect setState。 */
        setScrollTop(el?.scrollTop ?? 0);
      }}
    >
      {topSlot}
      {entries.length === 0 ? (
        emptySlot
      ) : (
        /* 外层撑出估算总高（滚动条长度与真实内容一致），内层 `translateY` 到当前
         * 窗口起点——只挂视口内的几十行。 */
        <div className="relative w-full" style={{ height: `${scrollHeight}px` }}>
          <div
            className="absolute top-0 left-0 w-full"
            style={{
              transform: `translateY(${rows[rowWindow.start]?.start ?? 0}px)`,
            }}
          >
            {rowWindow.entries.map((entry, offset) => {
              const index = rowWindow.start + offset;
              return (
                <div
                  data-log-estimated={rows[index]?.size ?? LOG_ROW_SINGLE}
                  data-log-index={index}
                  data-log-message={getMessage(entry)}
                  key={`log-${index}`}
                  ref={measureRow}
                  /* minHeight 而非 height：多行内容撑开行盒（实测校正见上），
                   * 不再被固定行高截断、与后一行重叠（ISSUE #4618）。 */
                  style={{ minHeight: `${rows[index]?.size ?? LOG_ROW_SINGLE}px` }}
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
