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
//
// **`ms` 可以是函数**（ISSUE #1351）：存活探测要「按阶段给频率」（启动等待
// 400ms、空闲 15s、出图 30s、隐藏 60s），而档位在运行中会变。函数形态让
// 「下一拍等多久」在**每拍跑完之后**重新问一次 —— 调用方因此不必 stop/start
// 换档（那会重放一次「立刻先跑」，正好多打一探测在高峰期）。细节见
// {@link PollTimerOptions.ms}。

import { fireAndForget } from "~/lib/async-action";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";

/** 启动一条轮询；返回停止函数。 */
export interface PollTimerOptions {
  /** 间隔毫秒数；`null` / `0` 表示不跑。
   *
   *  也可以给一个**函数**：每次跑完都重新问一次「下一拍等多久」。这是
   *  「按阶段给频率」唯一的落点（ISSUE #1351）—— 存活探测在「启动等待 /
   *  空闲 / 出图 / 隐藏」四档之间的间隔差一个数量级，而档位在**运行中**变
   *  （用户点了生成、切走了窗口），一个创建时就定死的数字表达不了。
   *
   *  为什么不让调用方自己 stop/start 来换间隔：那会把「停表 → 立刻先跑一次
   *  → 重新装事件监听」这段**每次都重放一遍**，于是切一次档就多发一探测
   *  （而出图档本来就该降压，这一下正好打在高峰期）。函数形态只在**本拍跑完之后**
   *  生效，不会抢跑。
   *
   *  函数返回 `null` 表示「**下一拍不排**」（调用方仍可经 `stop()` / 重建拉起）；
   *  返回 `0` 表示「立刻再跑一拍」（事件驱动那一档）。两者**不可混为一谈**：
   *  把 `null` 当 `0` 会成为忙等（实测一秒空转上万次）。 */
  ms: number | null | (() => number | null);
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
  /* 固定间隔与函数间隔走**两条装表路径**：固定值用 `setInterval`（最省事、语义
   * 也最直白），函数值必须用 `setTimeout` 链 —— 每拍跑完才知道下一拍等多久。 */
  const dynamic = typeof ms === "function";
  if (!dynamic && (ms == null || ms <= 0)) return () => undefined;

  // 未显式指定时按运行环境决定：桌面壳里默认开、浏览器 tab 里默认关。
  const unfocused = pauseWhenUnfocused ?? isDesktopShell();

  let timer: ReturnType<typeof setInterval> | null = null;
  let chain: ReturnType<typeof setTimeout> | null = null;

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
    if (chain !== null) {
      clearTimeout(chain);
      chain = null;
    }
  };
  const start = (): void => {
    stop();
    if (immediate) tick();
    if (!dynamic) {
      timer = setInterval(tick, ms);
      return;
    }
    /* 函数形态：本拍跑完再问下一拍的间隔。`run` 是异步的，但这里**不等它**
     * ——等待会让「上一轮还没回来」变成阻塞，而背压是调用方的事（见文件头）。
     * 「跑完再排」在这里的含义是「本拍已发车」，不是「本拍已到站」。 */
    const arm = (): void => {
      const next = ms();
      /* `null` = 下一拍不排（调用方靠 `stop()` / 重建拉起，或者它自己会重新
       * 订阅）。**不能与 `0` 混为一谈**：`0` 是「立刻再跑一拍」（事件驱动那一档），
       * 把 `null` 也当成 0 就成了忙等 —— 实测这条会在一秒内空转上万次。 */
      if (next === null) return;
      const delay = next <= 0 ? 0 : next;
      chain = setTimeout(() => {
        tick();
        arm();
      }, delay);
    };
    arm();
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
