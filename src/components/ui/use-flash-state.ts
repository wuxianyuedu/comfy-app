"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 「按一下就亮，过一会儿自己复位」的一次性反馈状态。
 *
 * 此前这套动作散在 6 个文件里各写一份，写法分成两族：
 *  - **裸 `setTimeout` 族**（4 处：设置页报错复制、`ProjectOutputs`、
 *    `WorkflowNodeJsonPopover`、`ui/json-viewer`）：`setCopied(true)` 紧跟
 *    `setTimeout(() => setCopied(false), 1500)`，定时器**没人管**；
 *  - **手写 timer ref 族**（`logs/LogRow`、`logs/SaveExportButton`）：
 *    自己 `useRef` + 卸载时 `clearTimeout` + 每次重设前先清旧的。
 *
 * 两族的差别不是风格，是**缺陷**：
 *  1. 裸 `setTimeout` 在组件卸载后仍然 `setState`（React 会对已卸载组件告警，
 *     而日志行**会**随翻页/锚点窗口被卸载）；
 *  2. 连点时旧定时器没被清掉 —— 第一次的复位会**提前**把第二次的亮起抹掉，
 *     表现为「连点两下，第二下只有一半时间亮着」；
 *  3. 复位时长 1200 / 1400 / 1500 / 8000 各不相同，没有任何一处说得清
 *     为什么是它。现在由 `DEFAULT_FLASH_MS` 一处给出默认，需要不同的落点
 *     显式传值（`logs` 的保存结果要留 8s 让用户看清路径，是真需要更长）。
 */

/** 默认亮起时长：1.5s —— 够看清「已复制」三个字，又不至于挡住下一次点击。 */
export const DEFAULT_FLASH_MS = 1500;

export interface FlashState {
  /** 当前是否处于亮起态。 */
  on: boolean;
  /** 亮起并起一个定时器，到点自动复位（重复调用会清掉上一个定时器）。 */
  flash: () => void;
  /** 立即复位，不等待定时器（如用户手动关闭提示）。 */
  reset: () => void;
}

/**
 * 用法：
 *
 * ```tsx
 * // 拿到「是否亮着」与「亮一下」两个出口
 * const copied = useFlashState(); // 亮起态 + flash()
 * // 实际用到：成功才亮起（失败时亮「已复制」是撒谎）
 * onClick={() => copyText(text).then((ok) => ok && copied.flash())} // 成功才 flash
 * // 文案按 on 切换，时长由 hook 自己收
 * {copied.on ? "已复制" : "复制"} // 文案跟着切换
 * ```
 *
 * `durationMs` 只在**确实需要**非默认时长时传（并在调用处写明理由）。
 */
export function useFlashState(durationMs = DEFAULT_FLASH_MS): FlashState {
  const [on, setOn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /* 卸载时清掉定时器：本 hook 的消费点里有会被频繁卸载的（日志行随翻页
   * 重建），不清就是往已卸载组件上 setState。 */
  useEffect(() => clear, [clear]);

  const flash = useCallback(() => {
    /* 先清旧的再设新的：否则连点时第一次的复位会提前抹掉第二次的亮起。 */
    clear();
    setOn(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setOn(false);
    }, durationMs);
  }, [clear, durationMs]);

  const reset = useCallback(() => {
    clear();
    setOn(false);
  }, [clear]);

  return { on, flash, reset };
}

/**
 * 同一条「亮起 → 到点复位」的时间轴，但**载荷是字段**。
 *
 * 适合「一次动作产生多个同时过期的可见值」的落点：`logs/SaveExportButton`
 * 保存后同时给出「已保存 <路径>」与失败标记，两者必须**同生共死** ——
 * 两个 `useFlashState` 会各起一个定时器，时长一改就漂移。
 *
 * `empty` 作为「未亮起」的初值，其身份必须稳定（模块级常量或 `useMemo`），
 * 否则每次渲染都会重置定时器的依赖。
 */
export function useFlashLatch<T>(durationMs: number, empty: T) {
  const [value, setValue] = useState<T>(empty);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const flash = useCallback(
    (next: T) => {
      clear();
      setValue(next);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setValue(empty);
      }, durationMs);
    },
    [clear, durationMs, empty],
  );

  const reset = useCallback(() => {
    clear();
    setValue(empty);
  }, [clear, empty]);

  return { value, flash, reset };
}
