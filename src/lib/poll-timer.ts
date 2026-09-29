"use client";

// ── 「按固定间隔重复跑一个异步动作」的非 React 内核 ─────────────────────
//
// 为什么把这段从 `~/components/ui/use-interval` 里抽出来：那个 hook 是全库轮询的
// 唯一出口（规范 16 §16.2.4.15），但**它只能在组件里跑**。当一份观测要收成
// 「全页单点持有者」（多个组件共用一条轮询，而不是各自拉一份，见
// `~/lib/comfy/comfy-stats-store`），持有者就不是组件了 —— 只能自己接 `setInterval`。
// 如果那时把「立即先跑一次 / 后台暂停 / 回前台补跑 / 桌面壳失焦也暂停」再抄一遍，
// 就等于把 §16.2.4.15 刚收口的重复**重新造回来**，而且两份的暂停判据一定会漂。
//
// 所以：这段是那条规则的**实现本体**，`useInterval` 只是它的 React 外壳。
// 语义、边界与坑（含「上一轮没回来就发下一轮」不在这里挡，那是背压、由调用方决定）
// 全部以 `use-interval.ts` 的文件头为准，两处共用同一份判断，不各写一套。

import { fireAndForget } from "~/lib/async-action";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";

/** 启动一条轮询；返回停止函数。 */
export interface PollTimerOptions {
  /** 间隔毫秒数；`null` / `0` 表示不跑。 */
  ms: number | null;
  /** 启动时是否立即先跑一次（默认 true）。 */
  immediate?: boolean;
  /** 页面不可见时是否暂停（默认 true），回前台立即补跑一次。 */
  pauseWhenHidden?: boolean;
  /** 窗口失焦时是否也暂停；缺省跟随 `isDesktopShell()`。 */
  pauseWhenUnfocused?: boolean;
  /**
   * 轮询动作抛错时的通道，**必填**：本文件在 `src/lib`，那里不许直接 `console.*`
   * 写日志（判据 `tests/single-logger-channel.test.ts`「日志实现只有一处」）。
   * 所以通道由调用方给：视图侧外壳（`useInterval`）给浏览器控制台；库侧持有者给
   * 业务语义的通道（例如把「本轮观测失败」并进同一条离线迟滞），而不是另开一条
   * 日志通道。
   */
  onError: (err: unknown) => void;
}

/**
 * 立刻按当前配置跑一次（`immediate` 时），并在窗口重新可见/重新聚焦时补跑；
 * 返回的函数负责停表与摘事件。**在浏览器之外调用是不安全的** —— 与 `useInterval`
 * 同一约束，判据都落在 `document` / `window` 上。
 */
export function startPollTimer(
  run: () => unknown,
  {
    ms,
    immediate = true,
    pauseWhenHidden = true,
    pauseWhenUnfocused,
    onError,
  }: PollTimerOptions,
): () => void {
  if (ms == null || ms <= 0) return () => undefined;

  // 未显式指定时按运行环境决定：桌面壳里默认开、浏览器 tab 里默认关。
  const unfocused = pauseWhenUnfocused ?? isDesktopShell();

  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    /* `run` 可以是 async 函数，返回值因此可能是 Promise。这里不写 `void run()`：
       那条形态一是撞上 src/lib 的「void 悬空 Promise」棘轮（悬浮 Promise 没人负责），
       二是失败会静默沉掉。统一交给 `fireAndForget`，通道由调用方的 `onError` 决定。 */
    fireAndForget(Promise.resolve(run()), onError);
  };
  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const start = (): void => {
    stop();
    if (immediate) tick();
    timer = setInterval(tick, ms);
  };

  if (!pauseWhenHidden && !unfocused) {
    start();
    return stop;
  }

  // 停轮询的判据：任一命中即「用户此刻不在这个窗口上」。
  // - `visibilitychange` 覆盖：浏览器切标签页 / 最小化 / 系统休眠；
  // - `document.hasFocus()` 覆盖：桌面壳里窗口被别的窗口遮挡但未最小化，
  //   `visibilityState` 仍是 visible，`visibilitychange` 不触发。
  const shouldPause = (): boolean => {
    if (pauseWhenHidden && document.visibilityState !== "visible") return true;
    if (unfocused && !document.hasFocus()) return true;
    return false;
  };

  const onChange = (): void => {
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
}
