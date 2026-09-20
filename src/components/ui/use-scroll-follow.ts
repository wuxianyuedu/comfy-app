"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useScrollFollow —— 「让一段滚动内容跟随底部（贴底）」的**唯一实现**
 * （规范 16 §16.2.4.24）。
 *
 * 为什么收口：全库有 **4 处**各写一份「内容一变就把 `scrollTop` 设成
 * `scrollHeight`」，写法看着都对，**判据却各不相同**：
 *
 * | 落点 | 贴底时机 | 「跟随态」怎么算 |
 * | --- | --- | --- |
 * | `RuntimeLogBox`（设置页运行日志） | `[log.text, follow]` 变化 | `scrollHeight - scrollTop - clientHeight < 32` |
 * | `GlobalStepLogPanel`（画布步骤日志） | `[logs, filter, autoscroll]` 变化 | 只有 `autoscroll` 布尔，**没有「用户上滚即退出跟随」** |
 * | `WorkflowRunLogModal`（工作流库运行日志） | `[logs.length, filter, autoscroll, open]` | 同上 |
 * | `AgentOverlay`（工坊对话） | `[messages, busy]` 变化 | **连开关都没有**，永远强行贴底 |
 *
 * 也就是说 —— **「用户往上滚会不会被拽回去」取决于看的是哪一个面板**：
 * `RuntimeLogBox` 会退出跟随并给出「恢复自动滚动」按钮，另三处会把用户
 * 按回底部（`AgentOverlay` 里甚至读不到上一句 AI 回复，滚上去立刻被拉回）。
 * 这类差异没有报错、没有告警，tsc / eslint 也都不看。
 *
 * ## 三件此前各处写不全的事
 *
 * 1. **贴底阈值只有一处**（`NEAR_BOTTOM_PX`，默认 32）。这个数字此前在
 *    两个文件里各写一份，含义是「离底多近仍算还在跟随」—— 小于它就退出
 *    跟随，用户上滚一点不该立刻掉出跟随态。
 * 2. **跟随态是 hook 的输出**，不是调用处自己算的布尔。给了它才能在界面上
 *    给出「已暂停跟随 · 回到最新」这类**用户可见出口**（硬规则 4：
 *    失败/降级路径必须有可见出口），否则用户只会觉得「日志不刷新了」。
 * 3. **依赖「内容变了没有」由调用处给**（`watch`），hook 不做深比较 ——
 *    「什么算新内容」是域判据（日志条数 / 文本 / 消息数组），
 *    硬在这里做深比较既不准也慢。
 *
 * ⚠️ **不接管虚拟化面板的贴底**：`LogPanel` 的贴底要按「位置表」算目标行
 * （`log-virtual` 的 `pinPlan` / `pinScrollTop`），语义是「钉住已读水位」而不是
 * 「滚到最底」—— 两者不是同一件事，别把它改成本 hook 的调用方。
 */
export interface UseScrollFollowOptions {
  /**
   * 滚动容器。**由调用处用 `useRef` 建好传进来**，而不是由本 hook 返回 ——
   * `react-hooks/refs` 会把「含 `useRef` 的 hook 的返回值」整体判成 ref 敏感，
   * 于是调用点每次读 `follow.following` 都会被报「渲染期访问 ref」。
   * 换成「调用处持有 ref」，返回值里就只有状态与回调，谁都不必写豁免。
   */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * 「内容变了没有」的依赖值：变了就（在跟随态下）重新贴底。
   *
   * 传什么由调用处决定（日志条数 / 文本 / 消息数组的引用）。**不要**为了
   * 让它「更灵敏」而传一个每次渲染都新建的对象 —— 那等于每帧都贴底，
   * 用户永远滚不上去。
   */
  watch: unknown;
  /** 离底多少像素内仍算「还在跟随」。缺省 `NEAR_BOTTOM_PX`。 */
  thresholdPx?: number;
  /**
   * 完全受控的跟随态。给了它，hook 不再自持状态 —— 用于**同一份跟随态要跨
   * 多个实例共享**的落点（`RuntimeLogBox` 的小窗口与全屏各挂一个滚动容器，
   * 切进去时应仍是「已暂停」）。不给则非受控，hook 自己管。
   */
  following?: boolean;
  /** 受控模式下跟随态的变化回调（用户上滚 → `false`；用户点「回到最新」→
   *  `true`）。非受控模式忽略。 */
  onFollowingChange?: (following: boolean) => void;
}

export interface ScrollFollow {
  /** 摊到滚动容器上的 `onScroll` —— 由它判定用户有没有接管滚动。 */
  onScroll: () => void;
  /** 当前是否仍在跟随底部。`false` 时调用处必须给出「回到最新」的入口。 */
  following: boolean;
  /** 立刻回到最新（界面上的「回到最新」/「恢复自动滚动」按钮调它）。 */
  jumpToLatest: () => void;
}

/** 离底多少像素内仍算「还在跟随」——全库唯一一处定义。 */
export const NEAR_BOTTOM_PX = 32;

/**
 * 用法（非受控）：先 `const box = useRef(null)`（**ref 由调用处持有**，见
 * `containerRef` 那条的说明），再把它与「内容依赖值」一起传进来；容器上摊
 * `box` 与 `follow.onScroll`，两个缺一不可。
 * 受控时多传 `following` / `onFollowingChange`（跟随态提升到父级，
 * 多个滚动容器共用一份，见 `RuntimeLogBox`）。
 *
 * `following === false` 时**必须**给出可见出口（按钮 / 徽标），否则用户会以为
 * 「内容不刷新了」—— 这正是收口前另三处缺的那一半。
 */
export function useScrollFollow({
  containerRef: ref,
  watch,
  thresholdPx = NEAR_BOTTOM_PX,
  following: controlled,
  onFollowingChange,
}: UseScrollFollowOptions): ScrollFollow {
  const [internal, setInternal] = useState(true);
  const following = controlled ?? internal;

  /* 当前跟随态放 ref：`onScroll` 里要立刻拿来比较（state 在事件里读到的可能
   * 是这一批渲染的值，快速滚动下会判错），且回调不该进依赖数组。 */
  const followingRef = useRef(following);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);

  const notifyRef = useRef(onFollowingChange);
  useEffect(() => {
    notifyRef.current = onFollowingChange;
  }, [onFollowingChange]);

  /* 贴底。`following` 进依赖数组是必须的：用户点「回到最新」把跟随态改回
   * true 之后，即使内容没变也要立刻贴一次（否则要等下一条日志才动）。 */
  useEffect(() => {
    if (!following) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [ref, watch, following]);

  const setFollowing = useCallback(
    (next: boolean) => {
      if (followingRef.current === next) return;
      followingRef.current = next;
      /* 受控模式下不自持状态：值由父级给回来，这里只通知。 */
      if (controlled === undefined) setInternal(next);
      notifyRef.current?.(next);
    },
    [controlled],
  );

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setFollowing(
      el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx,
    );
  }, [ref, setFollowing, thresholdPx]);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    /* 先动 DOM 再改状态：`following` 从 false 变 true 会触发上面那个 effect，
     * 那一轮贴底与这里的写入同解（都是滚到底），不会互相打架。 */
    if (el) el.scrollTop = el.scrollHeight;
    setFollowing(true);
  }, [ref, setFollowing]);

  return { onScroll, following, jumpToLatest };
}
