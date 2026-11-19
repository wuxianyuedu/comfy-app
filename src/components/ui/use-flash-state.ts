"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 「按一下就亮，过一会儿自己复位」的一次性反馈状态。此前散在 6 个文件里，写法分两族：裸 `setTimeout` 族（4 处，
 * 定时器没人管）与手写 timer ref 族（自己 `useRef` + 卸载清理 + 重设前先清）。两族的差别是**缺陷**：① 卸载后仍
 * `setState`（日志行会随翻页被卸载）；② 连点时旧定时器没清 —— 第一下的复位会提前抹掉第二下的亮起；③ 时长
 * 1200/1400/1500/8000 各处不同且无理据，现由 `DEFAULT_FLASH_MS` 给默认、需要不同的落点显式传值（`logs` 留 8s）。 */

/** 默认亮起时长：1.5s —— 够看清「已复制」三个字，又不至于挡住下一次点击。 */
export const DEFAULT_FLASH_MS = 1500;

export type FlashState = {
  /** 亮起并起一个定时器，到点自动复位（重复调用会清掉上一个定时器）。 */
  flash: () => void;
  /** 当前是否处于亮起态。 */
  on: boolean;
  /** 立即复位，不等待定时器（如用户手动关闭提示）。 */
  reset: () => void;
};

/**
 * 用法：`const copied = useFlashState()`，成功才 `copied.flash()`（失败时亮「已复制」是撒谎），
 * 文案按 `copied.on` 切换。`durationMs` 只在**确实需要**非默认时长时传，并在调用处写明理由。
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

/** 同一条「亮起 → 到点复位」的时间轴，但**载荷是字段**。适合「一次动作产生多个同时过期的可见值」的落点：
 * `logs/SaveExportButton` 保存后要同时给「已保存 <路径>」与失败标记，两者**同生共死** —— 两个 `useFlashState`
 * 会各起一个定时器、时长一改就漂移。`empty` 作为「未亮起」初值身份必须稳定（模块级常量或 `useMemo`），
 * 否则每次渲染都会重置定时器依赖。 */
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
