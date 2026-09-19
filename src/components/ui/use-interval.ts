"use client";

import { useEffect, useRef } from "react";

/**
 * useInterval —— 「按固定间隔重复跑一个异步动作」的**唯一实现**
 * （规范 16 §16.2.4.15）。
 *
 * 为什么收口：全库有 **9 处**各自 `setInterval(onDone, N)` + 在清理函数里
 * `clearInterval`，写法分成几族、缺陷也各不相同：
 *
 *  - **不立刻跑一次**（只等第一个间隔到点）：`use-training-studio`、
 *    `VideoQueueModal`、`use-history-panel`、`use-runtime-log-source` ——
 *    用户要等一个完整间隔才看到内容（挂载后先空着）；
 *  - **在后台标签页里空转**：浏览器把后台定时器降到 ≥1min 一次，但请求仍然
 *    发出，白白占着服务端；只有 `use-comfy-stats` 与 `use-update-check`
 *    接了 `visibilitychange` 暂停 —— 而**同一段「前后台开关」被逐字抄了两份**；
 *  - **跑在已卸载的组件上**：`setInterval(() => void poll())` 里没有「是否
 *    已卸载」的守卫，异步回调可能在组件消失后才 `setState`。
 *
 * 本 hook 把这三件事一次给全：
 *  1. 挂载即先跑一次（`immediate`，默认 true），不等第一个间隔；
 *  2. `pauseWhenHidden`（默认 true）—— 切后台暂停、回前台**立即补跑一次**，
 *     语义与 `use-comfy-stats` / `use-update-check` 的既有实现一致；
 *  3. 间隔之间的「上一轮还没回来就发下一轮」不在这里挡 —— 那是**背压**问题，
 *     由调用方决定（多数轮询是幂等的单次查询，重叠无害；需要串行的落点应自己
 *     在 `run` 里排队）。本 hook 只负责「什么时候该跑」。
 *
 * 与 `useFlashState`（一次性定时器）的分工：那个管「按一下亮一会儿」，
 * 这个管「每隔一段时间重复跑」。两者都用定时器，但取消语义与生命周期不同。
 */
export interface UseIntervalOptions {
  /** 间隔毫秒数；传 `null` / `0` 表示**不轮询**（受控开关）。 */
  ms: number | null;
  /** 是否在挂载时立即执行一次（默认 `true`）。 */
  immediate?: boolean;
  /**
   * 是否在页面不可见时暂停（默认 `true`）。
   * 暂停期间不发起调用；`visibilitychange` 回到 visible 时**立即补跑一次**
   * 再恢复定时（与 `use-comfy-stats` 的既有行为一致 —— 用户切回来看到的
   * 是最新状态，不用等一个间隔）。
   */
  pauseWhenHidden?: boolean;
}

/**
 * @param run 每个间隔要跑的动作（返回值被忽略 —— 允许直接传 `async` 函数，
 *   包括返回 `boolean` 的 `checkNow` 这类）。它会被放进 ref，因此**不必**
 *   为稳定性包 `useCallback` —— 传新函数不会重建定时器（这是此前两处
 *   `useCallback` 依赖数组容易写错的地方）。
 */
export function useInterval(
  run: () => unknown,
  { ms, immediate = true, pauseWhenHidden = true }: UseIntervalOptions,
): void {
  const runRef = useRef(run);
  /* 渲染期写 ref 会被 react-hooks/refs 判为「渲染期访问 ref」，且并发渲染下
   * 可能写到被丢弃的那次渲染上 —— 在 effect 里同步（同 `use-update-check`
   * 的 `onDirtyRef`）。 */
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (ms == null || ms <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      void runRef.current();
    };
    const start = () => {
      if (timer !== null) clearInterval(timer);
      if (immediate) tick();
      timer = setInterval(tick, ms);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (!pauseWhenHidden) {
      start();
      return stop;
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    /* 首帧就按当前可见性决定起停：标签页在后台打开时不必先空跑一次。 */
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, immediate, pauseWhenHidden]);
}
