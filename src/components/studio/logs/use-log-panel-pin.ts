"use client";

/**
 * LogPanel 的「贴底只追到基线」行为。
 *
 * 若照「时间线一变就 scrollTop = scrollHeight」来写，它**每两秒就成立一次**
 * （几乎每轮轮询都有新行），于是内容每隔两秒整体上移一次，用户刚框住的文本立刻
 * 被滚动冲掉。现在只在**贴着底**时把「已读水位」（基线）钉住，新行在下面累积，
 * 腾出的空间交给页脚的「有 N 条新的日志 · 回到最新」。任何一层成立都不动滚动
 * 位置：不在第 1 页（在看历史）/ 用户没贴着底（自己滚走了）/ 正在框选日志文本。
 *
 * 位置怎么算是纯逻辑（`log-virtual` 的贴底一组）；这里只读写 ref，不用 state
 * ——用 state 承载会让贴底本身触发重渲染，落进「滚动 → 重渲染 → 再滚动」的循环。
 */
import { useCallback, useEffect, useRef } from "react";
import { pinPlan, pinScrollTop } from "./log-virtual";
import { selectionInsideLogs } from "./log-row-style";
import { currentSelection } from "./log-panel-selection";

export function useLogPanelPin(input: {
  isOpen: boolean;
  autoScroll: boolean;
  safePage: number;
  followResetAt: number;
  /** store 修订号：每次日志追加都重跑贴底判定。 */
  revision: number;
  /** 当前页渲染用的日志（锚定窗口 / 历史页固定窗口）。 */
  visibleLogs: { id: string }[];
  /** 行位置表（整页前缀和），与 visibleLogs 同源同长。 */
  rows: { start: number; size: number }[];
  /** 滚动视口元素（父组件持有 ref，贴底 / 滚动都读写它）。 */
  bodyRef: { current: HTMLDivElement | null };
  /** 滚动位置是渲染输入（决定窗口取哪一段），父组件据此进 state。 */
  setScrollTop: (top: number) => void;
  setFollowBottom: (near: boolean) => void;
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

  /* ── 贴底：只追到「基线」，不再追着最新跑（ISSUE #262 复审）────────────
   *
   * 旧行为是「时间线一变就 scrollTop = scrollHeight」，而它**每两秒就成立一次**
   * （几乎每轮轮询都有新行），于是内容每隔两秒整体上移一次，用户刚框住的文本立刻
   * 被滚动冲掉。现在只在**贴着底**时把「已读水位」（基线）钉住，新行在下面累积，
   * 腾出的空间交给页脚的「有 N 条新的日志 · 回到最新」。任何一层成立都不动滚动
   * 位置：不在第 1 页（在看历史）/ 用户没贴着底（自己滚走了）/ 正在框选日志文本。
   *
   * 位置怎么算是纯逻辑（见 `log-virtual` 的贴底一组）；这里只读写 ref，不用 state
   * ——用 state 承载会让贴底本身触发重渲染，落进「滚动 → 重渲染 → 再滚动」的循环。
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

    /* 目标行 + 「用户有没有接管滚动」的判据都在 `log-virtual` 的 `pinPlan`：
     * 用户自己滚到别处（例如滚到底看最新）时返回 `null`，本轮不动他的位置。 */
    const targetIndex = pinPlan({
      baseline: baselineRef.current,
      applied: appliedRef.current,
      bottomIndex: visibleLogs.length - 1,
      scrollTop: el.scrollTop,
      appliedTop: appliedTopRef.current,
    });
    if (targetIndex === null) return;
    /* 贴到目标行的下边缘（减去一个视口高）：位置一律取自**位置表**
     * `rows[targetIndex]`，那是 `translateY` 与滚动条共用的同一份口径。
     *
     * ⚠️ **不能用 `target.offsetTop` 量**。虚拟化之后行的 `offsetParent` 是那层
     * `translateY` 过的内层容器，`offsetTop` 给的是「它在**当前窗口**里的位置」
     * 而不是「它在整页内容里的位置」；拿它算 `scrollTop` 会把视口拉回窗口起点
     * ——用户滚到底就再也回不去底（这条 e2e 抓到的正是它）。
     *
     * 目标行在窗口外时它根本不在 DOM 里，这一支天然也走同一个算式：把目标行带进
     * 窗口，下一轮 effect 按同一张表对齐（两轮同解，不再有「真实节点」与「估算
     * 位置」两套坐标）。`rows[targetIndex]` 与 `pageLogs` 同源同长；真取不到就
     * 什么都不做，绝不能乱滚。 */
    const row = rows[targetIndex];
    if (!row) return;
    const next = pinScrollTop(
      { start: row.start, size: row.size },
      el.clientHeight,
    );
    el.scrollTop = next;
    appliedTopRef.current = next;
    appliedRef.current = targetIndex;
  }, [
    isOpen,
    autoScroll,
    safePage,
    revision,
    followResetAt,
    visibleLogs.length,
    rows,
    bodyRef,
  ]);

  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    /* 滚动位置是**渲染输入**（决定窗口取哪一段），因此进 state 而不是只留 ref：
     * 只读 ref 会出现「滚了但不重渲染、内容不更新」。 */
    setScrollTop(el.scrollTop);
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    /* 贴着底 = 用户要看最新，基线就取末条（面板打开时 `autoScroll` 已是 true，
     * 若再要求 `!autoScroll` 则「从顶部滚到底」永远进不来，基线停在 0，下一轮
     * 轮询会把用户按回顶部）。
     *
     * 这里**只重取基线**（水位锚点），不动 `appliedRef`：那个 ref 回答的是「贴底
     * 上一次落在哪一行」，只有贴底 effect 自己写过才算数（`pinPlan` 据它判「用户
     * 有没有接管滚动」）。把滚动事件也算成「已落位」，会让 `pinPlan` 把「贴底刚被
     * 重取基线」误读成「用户自己滚走了」，于是本轮一步都不动 —— 用户滚到底后贴底
     * 不再跟到页尾，又回到「滚不到底」。 */
    if (nearBottom) {
      baselineRef.current = Math.max(0, visibleLogs.length - 1);
    }
    setFollowBottom(nearBottom);
  }, [setFollowBottom, setScrollTop, bodyRef, visibleLogs.length]);

  return { onScroll };
}
