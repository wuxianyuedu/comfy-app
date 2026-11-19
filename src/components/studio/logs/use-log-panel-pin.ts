"use client";

/**
 * LogPanel 的「贴底只追到基线」行为（ISSUE #262 复审）：只在贴着底时钉住已读水位，
 * 新行在下面累积，腾出的空间交给页脚「有 N 条新的日志 · 回到最新」；不在第 1 页 / 没贴底 /
 * 正在框选都不动。位置算法是纯逻辑（`log-virtual`）；只读写 ref 不用 state，避免滚动重渲染循环。
 */
import { useCallback, useEffect, useRef } from "react";
import { pinPlan, pinScrollTop } from "./log-virtual";
import { selectionInsideLogs } from "./log-row-style";
import { currentSelection } from "./log-panel-selection";

export function useLogPanelPin(input: {
  autoScroll: boolean;
  /** 滚动视口元素（父组件持有 ref，贴底 / 滚动都读写它）。 */
  bodyRef: { current: HTMLDivElement | null };
  followResetAt: number;
  isOpen: boolean;
  /** store 修订号：每次日志追加都重跑贴底判定。 */
  revision: number;
  /** 行位置表（整页前缀和），与 visibleLogs 同源同长。 */
  rows: Array<{ size: number; start: number }>;
  safePage: number;
  setFollowBottom: (near: boolean) => void;
  /** 滚动位置是渲染输入（决定窗口取哪一段），父组件据此进 state。 */
  setScrollTop: (top: number) => void;
  /** 当前页渲染用的日志（锚定窗口 / 历史页固定窗口）。 */
  visibleLogs: Array<{ id: string }>;
}) {
  const {
    isOpen,
    autoScroll,
    safePage,
    followResetAt,
    revision,
    visibleLogs,
    rows,
    bodyRef,
    setScrollTop,
    setFollowBottom,
  } = input;

  const baselineRef = useRef(0);
  /* 上一次贴底落在页面里的序号；仅用于「有新增才滚」的比较（不参与可见输出）。 */
  const appliedRef = useRef(-1);
  /* 上一次贴底**自己**写入的 `scrollTop`：据此判定「用户有没有接管滚动」
   * （见 `log-virtual` 的 `pinShouldYield`），是记账值，不进 state。 */
  const appliedTopRef = useRef(0);

  /* ── 贴底：只追到「基线」，不再追着最新跑（ISSUE #262 复审）：只在贴着底时钉住
   * 已读水位、新行在下面累积；不在第 1 页 / 用户没贴底 / 正在框选都不动滚动位置。
   * 位置算法是纯逻辑（`log-virtual`）；只读写 ref 不用 state，避免「滚动 → 重渲染 → 再滚动」。 */
  useEffect(() => {
    if (!isOpen) {
      baselineRef.current = 0;
      appliedRef.current = -1;
      return;
    }
    if (safePage !== 1 || !autoScroll) {
      return;
    }
    const el = bodyRef.current;
    if (!el) {
      return;
    }

    /* 用户点过「回到最新」→ 不再受基线约束，一路追到最新一页的底部。 */
    if (followResetAt > 0) {
      baselineRef.current = Math.max(0, visibleLogs.length - 1);
    }
    /* **正在框选就什么都别做**：拖动过程中浏览器会随滚动改锚点，滚动会打断框选
     * ——这正是「刚选中就被刷新弄没」的最后一环（前两环在 store：贴底基线）。 */
    if (selectionInsideLogs(currentSelection())) {
      return;
    }

    /* 目标行 + 「用户有没有接管滚动」的判据都在 `log-virtual` 的 `pinPlan`：
     * 用户自己滚到别处（例如滚到底看最新）时返回 `null`，本轮不动他的位置。 */
    const targetIndex = pinPlan({
      baseline: baselineRef.current,
      applied: appliedRef.current,
      bottomIndex: visibleLogs.length - 1,
      scrollTop: el.scrollTop,
      appliedTop: appliedTopRef.current,
    });
    if (targetIndex === null) {
      return;
    }
    /* 贴到目标行下边缘（减一个视口高）：位置一律取自位置表 `rows[targetIndex]`，与 translateY、
     * 滚动条同一口径。不能用 `target.offsetTop`——虚拟化后 offsetParent 是 translateY 内层容器，它给
     * 「窗口内位置」，会把视口拉回窗口起点（e2e 抓到「滚不到底」）；目标行在窗口外时走同一张表对齐，取不到就不动。 */
    const row = rows[targetIndex];
    if (!row) {
      return;
    }
    const next = pinScrollTop({ start: row.start, size: row.size }, el.clientHeight);
    el.scrollTop = next;
    appliedTopRef.current = next;
    appliedRef.current = targetIndex;
  }, [isOpen, autoScroll, safePage, revision, followResetAt, visibleLogs.length, rows, bodyRef]);

  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) {
      return;
    }
    /* 滚动位置是**渲染输入**（决定窗口取哪一段），因此进 state 而不是只留 ref：
     * 只读 ref 会出现「滚了但不重渲染、内容不更新」。 */
    setScrollTop(el.scrollTop);
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    /* 贴着底 = 用户要看最新，基线取末条（autoScroll 已 true 时不能再要求 !autoScroll，
     * 否则「从顶部滚到底」进不来，基线停 0，下一轮轮询把用户按回顶部）。这里只重取基线、
     * 不动 `appliedRef`（它只由贴底 effect 写；算成已落位会让 `pinPlan` 误读成用户滚走了）。 */
    if (nearBottom) {
      baselineRef.current = Math.max(0, visibleLogs.length - 1);
    }
    setFollowBottom(nearBottom);
  }, [setFollowBottom, setScrollTop, bodyRef, visibleLogs.length]);

  return { onScroll };
}
