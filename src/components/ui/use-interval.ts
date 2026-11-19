"use client";

import { useEffect, useRef } from "react";

import { startPollTimer } from "~/lib/poll-timer";

/** useInterval —— 「按固定间隔重复跑一个异步动作」的唯一实现（规范 16 §16.2.4.15）。收口前全库 9 处各自 `setInterval` + 清理，
 * 缺陷各异：不立刻跑一次（挂载后先空着等一个间隔）；后台标签页空转（请求照发）；跑在已卸载组件上（异步回调后才 `setState`）。
 * 本 hook 一次给全：`immediate` 挂载先跑一次、`pauseWhenHidden` 切后台暂停且回前台立即补跑；背压由调用方决定
 *（例外：`ms` 返回 0 时 `~/lib/poll-timer` 会等本拍结算）。桌面补 `pauseWhenUnfocused`：WebView2 遮挡未最小化时
 * `visibilityState` 仍报 visible、`visibilitychange` 不触发，15 处轮询会白拉；默认跟随 `isDesktopShell()`。定时器 vs `useFlashState` 分工。 */
export type UseIntervalOptions = {
  /** 是否在挂载时立即执行一次（默认 `true`）。 */
  immediate?: boolean;
  /** 间隔毫秒数；传 `null` / `0` 表示**不轮询**（受控开关）。也可给**函数**：每拍跑完重新问一次「下一拍
   * 等多久」（用于按阶段给频率，ISSUE #1351：存活探测在启动等待 / 空闲 / 出图 / 隐藏四档跨一个数量级，
   * 档位运行中会变）。函数形态**必须引用稳定**（模块级常量或 `useCallback`），否则每次渲染换新函数会让
   * effect 重建定时器、计时被反复重置。 */
  ms: number | null | (() => number | null);
  /**
   * 轮询动作抛错时的通道；缺省落浏览器控制台（视图层可以这么写，
   * `src/lib` 里的实现本体不行 —— 见 poll-timer 的对应注释）。
   */
  onError?: (err: unknown) => void;
  /**
   * 是否在页面不可见时暂停（默认 `true`）。暂停期间不发起调用；`visibilitychange` 回到 visible 时
   * **立即补跑一次**再恢复定时（与 `use-comfy-stats` 既有行为一致：切回来看到最新状态，不用等一个间隔）。
   */
  pauseWhenHidden?: boolean;
  /**
   * 是否在窗口失焦时也暂停（默认跟随 `isDesktopShell()`）。桌面壳里 WebView2 遮挡未最小化时
   * `visibilitychange` 不触发，靠这条补上；浏览器 tab 默认 `false`（切焦点时用户可能仍希望页面跟新）。
   */
  pauseWhenUnfocused?: boolean;
};

/** 视图侧默认通道：一次失败一行，不炸轮询循环。 */
function reportPollError(err: unknown): void {
  console.error("[use-interval] 轮询动作抛错", err);
}

/**
 * `run` 是每个间隔要跑的动作（返回值被忽略，可直接传 `async` 函数）。它会被放进 ref，因此**不必**为
 * 稳定性包 `useCallback` —— 传新函数不会重建定时器。
 */
export function useInterval(
  run: () => unknown,
  {
    ms,
    immediate = true,
    pauseWhenHidden = true,
    pauseWhenUnfocused,
    onError = reportPollError,
  }: UseIntervalOptions,
): void {
  const runRef = useRef(run);
  /* onError 与 run 同样走 ref：它每次渲染可能是新的箭头函数，进了依赖数组就会
     因调用方内联写法而反复重建定时器；放 ref 里则由 effect 一次性接走、读最新值。 */
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  /* 渲染期写 ref 会被 react-hooks/refs 判为「渲染期访问 ref」，且并发渲染下
   * 可能写到被丢弃的那次渲染上 —— 在 effect 里同步（同 `use-update-check`
   * 的 `onDirtyRef`）。 */
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    /* 实现本体在 `~/lib/poll-timer` —— 那份「立即先跑 / 后台暂停 / 回前台补跑 /
       桌面壳失焦也暂停」的判据只能有一处：非 React 的持有者（如系统指标 store）
       也要用它，各写一份一定会漂。这里只负责把它接到组件生命周期上。 */
    return startPollTimer(() => runRef.current(), {
      ms,
      immediate,
      pauseWhenHidden,
      pauseWhenUnfocused,
      onError: (err: unknown) => {
        onErrorRef.current(err);
      },
    });
  }, [ms, immediate, pauseWhenHidden, pauseWhenUnfocused]);
}
