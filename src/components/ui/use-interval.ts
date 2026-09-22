"use client";

import { useEffect, useRef } from "react";

import { isDesktopShell } from "~/lib/shell/desktop-shell-client";

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
 * **桌面场景补的一条**（`pauseWhenUnfocused`）：WebView2 里窗口被别的窗口
 * 遮挡但未最小化时，`document.visibilityState` 仍报 `visible`、`visibilitychange`
 * 不会触发，全库 15 处轮询会**白拉**——用户切回来时看到的是几秒前的状态，
 * 而不是他目光回到窗口那一刻的实况。判据用 `document.hasFocus()` +
 * `window` 的 focus/blur 事件补上；默认跟随 `isDesktopShell()`（浏览器 tab
 * 场景保留既有语义，避免「切走焦点就不刷新」的过度反应）。
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
  /**
   * 是否在窗口失焦时也暂停（默认跟随 `isDesktopShell()`）。
   * 桌面壳里 WebView2 遮挡未最小化时，`visibilitychange` 不会触发，靠这条
   * 补上。浏览器 tab 场景**默认 false**：切焦点到别的窗口时用户可能仍希望
   * 页面在跟新（例如挂着看长任务进度），维持既有语义不越过边界。
   */
  pauseWhenUnfocused?: boolean;
}

/**
 * @param run 每个间隔要跑的动作（返回值被忽略 —— 允许直接传 `async` 函数，
 *   包括返回 `boolean` 的 `checkNow` 这类）。它会被放进 ref，因此**不必**
 *   为稳定性包 `useCallback` —— 传新函数不会重建定时器（这是此前两处
 *   `useCallback` 依赖数组容易写错的地方）。
 */
export function useInterval(
  run: () => unknown,
  {
    ms,
    immediate = true,
    pauseWhenHidden = true,
    pauseWhenUnfocused,
  }: UseIntervalOptions,
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

    // 未显式指定时按运行环境决定：桌面壳里默认开、浏览器 tab 里默认关。
    const unfocused = pauseWhenUnfocused ?? isDesktopShell();

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

    if (!pauseWhenHidden && !unfocused) {
      start();
      return stop;
    }

    // 停轮询的判据：任一命中即「用户此刻不在这个窗口上」。
    // - `visibilitychange` 覆盖：浏览器切标签页 / 最小化 / 系统休眠；
    // - `document.hasFocus()` 覆盖：桌面壳里窗口被别的窗口遮挡但未最小化，
    //   visibilityState 仍是 visible，`visibilitychange` 不触发。
    const shouldPause = () => {
      if (pauseWhenHidden && document.visibilityState !== "visible")
        return true;
      if (unfocused && !document.hasFocus()) return true;
      return false;
    };

    const onChange = () => {
      if (shouldPause()) stop();
      else start();
    };

    if (!shouldPause()) start();
    if (pauseWhenHidden) {
      document.addEventListener("visibilitychange", onChange);
    }
    if (unfocused) {
      window.addEventListener("focus", onChange);
      window.addEventListener("blur", onChange);
    }
    return () => {
      stop();
      if (pauseWhenHidden) {
        document.removeEventListener("visibilitychange", onChange);
      }
      if (unfocused) {
        window.removeEventListener("focus", onChange);
        window.removeEventListener("blur", onChange);
      }
    };
  }, [ms, immediate, pauseWhenHidden, pauseWhenUnfocused]);
}
