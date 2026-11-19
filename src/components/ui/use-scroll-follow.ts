"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** useScrollFollow —— 「滚动内容跟随底部（贴底）」的唯一实现（规范 16 §16.2.4.24）。收口前全库 4 处同形写法、判据各异：
 * `RuntimeLogBox` 退出跟随并给「恢复自动滚动」按钮，另三处把用户按回底部（`AgentOverlay` 连开关都没有）
 * —— 这类差异没有报错、没有告警。三件此前写不全的事：贴底阈值只一处（`NEAR_BOTTOM_PX = 32`）；跟随态是
 * hook 输出，才能给出「回到最新」这类可见出口（硬规则 4）；「内容变没变」由调用处给 `watch`，hook 不做深比较。
 * ⚠️ 不接管虚拟化面板：`LogPanel` 按 `pinPlan` / `pinScrollTop` 钉已读水位而非滚到最底，别改成本 hook 调用方。 */
export type UseScrollFollowOptions = {
  /**
   * 滚动容器，**由调用处用 `useRef` 建好传进来**，而不是由本 hook 返回 —— `react-hooks/refs`
   * 会把「含 `useRef` 的 hook 的返回值」整体判成 ref 敏感，读 `follow.following` 就会报「渲染期
   * 访问 ref」。调用处持有 ref 后，返回值里只有状态与回调，谁都不必写豁免。
   */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * 完全受控的跟随态。给了它，hook 不再自持状态 —— 用于**同一份跟随态要跨
   * 多个实例共享**的落点（`RuntimeLogBox` 的小窗口与全屏各挂一个滚动容器，
   * 切进去时应仍是「已暂停」）。不给则非受控，hook 自己管。
   */
  following?: boolean;
  /** 受控模式下跟随态的变化回调（用户上滚 → `false`；用户点「回到最新」→
   *  `true`）。非受控模式忽略。 */
  onFollowingChange?: (following: boolean) => void;
  /** 离底多少像素内仍算「还在跟随」。缺省 `NEAR_BOTTOM_PX`。 */
  thresholdPx?: number;
  /**
   * 「内容变了没有」的依赖值：变了就（在跟随态下）重新贴底。传什么由调用处决定（日志条数 /
   * 文本 / 消息数组的引用）。**不要**为「更灵敏」传一个每次渲染都新建的对象 —— 那等于每帧都
   * 贴底，用户永远滚不上去。
   */
  watch: unknown;
};

export type ScrollFollow = {
  /** 当前是否仍在跟随底部。`false` 时调用处必须给出「回到最新」的入口。 */
  following: boolean;
  /** 立刻回到最新（界面上的「回到最新」/「恢复自动滚动」按钮调它）。 */
  jumpToLatest: () => void;
  /** 摊到滚动容器上的 `onScroll` —— 由它判定用户有没有接管滚动。 */
  onScroll: () => void;
};

/** 离底多少像素内仍算「还在跟随」——全库唯一一处定义。 */
export const NEAR_BOTTOM_PX = 32;

/** 用法（非受控）：先 `const box = useRef(null)`（**ref 由调用处持有**，见 `containerRef`），再连同「内容依赖值」传入；
 * 容器上摊 `box` 与 `follow.onScroll`，两个缺一不可。受控时多传 `following` / `onFollowingChange`（跟随态提升到父级，
 * 多个滚动容器共用，见 `RuntimeLogBox`）。`following === false` 时**必须**给出可见出口（按钮 / 徽标），否则用户会以为
 *「内容不刷新了」。 */
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
    if (!following) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [ref, watch, following]);

  const setFollowing = useCallback(
    (next: boolean) => {
      if (followingRef.current === next) {
        return;
      }
      followingRef.current = next;
      /* 受控模式下不自持状态：值由父级给回来，这里只通知。 */
      if (controlled === undefined) {
        setInternal(next);
      }
      notifyRef.current?.(next);
    },
    [controlled],
  );

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx);
  }, [ref, setFollowing, thresholdPx]);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    /* 先动 DOM 再改状态：`following` 从 false 变 true 会触发上面那个 effect，
     * 那一轮贴底与这里的写入同解（都是滚到底），不会互相打架。 */
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    setFollowing(true);
  }, [ref, setFollowing]);

  return { onScroll, following, jumpToLatest };
}
