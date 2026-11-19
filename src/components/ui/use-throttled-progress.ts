"use client";

// ── 「把一次进度回调节流后写进 state」的唯一出口（规范 16 §16.2.4.68）──────
// `watchTask` 的 `onProgress` 是高频回调（SSE 每帧一次，一次生成可调几百次），全库 6 处各写一遍且没人节流、没人同值短路、没人带卸载守卫：每帧一次独立渲染、同值也新建对象、卸载后仍 setState（React 18+ 不告警）。
// 本出口一次给全三件：节流窗口（同窗口只取最后一次）、同值短路、卸载守卫。选节流而非防抖：进度是单调读数，防抖会推迟到安静之后，恰好在一直不安静时最需要更新。
// 与邻居分工：`watchTask` / `useInterval` 管多久来一次；本出口管多久写一次 state；`~/lib/progress` 管这个数是几；`ProgressBar` 管它长什么样。

import { useCallback, useEffect, useRef, useState } from "react";

/** 进度节流的默认窗口：约等于「一秒 10 帧」，肉眼已是连续推进。 */
export const PROGRESS_THROTTLE_MS = 100;

export type ThrottledProgress = {
  /** 立刻写入并解除节流（任务落定时调 —— 终值不允许被窗口吃掉）。 */
  flush: (value: number) => void;
  /**
   * 节流后的写入器 —— 直接交给 `onProgress`。
   * 同一个窗口内的多次调用只保留最后一次的值（进度是累计读数，中间值没有意义）。
   */
  report: (value: number) => void;
  /** 复位（开始新一轮任务前调，回到 `initial`）。 */
  reset: () => void;
  /** 最近一次落进 state 的读数（首帧前为 `initial`）。 */
  value: number;
};

/**
 * 把高频进度回调节流后写进 state（单值：一次只跑一个任务）。
 * 用法：`const pct = useThrottledProgress(0)`，订阅回调里 `pct.report(p)`、落定时 `pct.flush(100)`。`tickMs` 取 {@link PROGRESS_THROTTLE_MS}；传 `0` 表示不节流（逐帧写），只在「读数必须逐帧精确」时用。
 * ⚠️ 落定时必须调 `flush`：节流会在窗口边界丢掉最后一次读数，进度条停在 97% 而任务已完成正是「窗口把终值吃掉了」。
 */
export function useThrottledProgress(
  initial = 0,
  tickMs: number = PROGRESS_THROTTLE_MS,
): ThrottledProgress {
  const [value, setValue] = useState(initial);
  /* 两个 ref 都是「此刻的事实」，不该触发渲染：
   *   · `lastAtRef` —— 上一个窗口的起点（节流的判据）；
   *   · `mountedRef` —— 卸载守卫（见文件头第三条决定）。 */
  const lastAtRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const report = useCallback(
    (next: number) => {
      /* 卸载守卫：回调可能在组件消失之后才到达（`watchTask` 的关闭由调用处
       * 负责，漏一次就是这里兜住）。 */
      if (!mountedRef.current) {
        return;
      }
      if (!Number.isFinite(next)) {
        return;
      }
      const now = Date.now();
      if (tickMs <= 0 || now - lastAtRef.current >= tickMs) {
        lastAtRef.current = now;
        setValue((prev) => (prev === next ? prev : next));
      }
      /* 窗口内不排定时器：下一个窗口的第一次调用（或调用处的 `flush`）
       * 会把值写进去。不排定时器的好处是「组件卸载后定时器还在跑」这一类
       * 泄漏从结构上不存在。 */
    },
    [tickMs],
  );

  const flush = useCallback((next: number) => {
    if (!mountedRef.current) {
      return;
    }
    lastAtRef.current = Date.now();
    if (!Number.isFinite(next)) {
      return;
    }
    setValue((prev) => (prev === next ? prev : next));
  }, []);

  const reset = useCallback(() => {
    lastAtRef.current = 0;
    if (!mountedRef.current) {
      return;
    }
    setValue(initial);
  }, [initial]);

  return { value, report, flush, reset };
}

/**
 * 按条目的进度节流表 —— 「一个列表里多条同时在跑」的形态。
 * 工坊镜头台与画布流程此前各写一份 `Record<string, number>` 且两处逐字相同。
 * 与单值版三处语义差别：窗口按条目独立（否则先报的挤掉后报的）；`clear(key)` 一条跑完就清（否则整表复位会抹掉别的条目）；同值不换对象。返回的 `progress` 读法（`progress[shot.id] ?? 0`）不变。
 */
export type ThrottledProgressMap = {
  /** 清掉某一条（或不传 `key` 时清全部）。 */
  clear: (key?: string) => void;
  /** 立刻写入并解除该条目的节流（落定时调）。 */
  flush: (key: string, value: number) => void;
  /** 各条目最近一次落进 state 的读数。 */
  progress: Record<string, number>;
  /** 节流后的写入器 —— 直接交给 `onProgress`。 */
  report: (key: string, value: number) => void;
};

/**
 * 按条目的进度节流表。
 * 用法：`const pct = useThrottledProgressMap()`，订阅回调里 `pct.report(shotId, p)`、落定时 `pct.flush(shotId, 100)`。
 */
export function useThrottledProgressMap(
  tickMs: number = PROGRESS_THROTTLE_MS,
): ThrottledProgressMap {
  const [progress, setProgress] = useState<Record<string, number>>({});
  /* 每个条目一个窗口起点：三条同时在跑时互不干扰（见文件头第一条差别）。 */
  const lastAtRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* 写一条：**值没变就不换对象** —— 收口前无条件 `{ ...prev, [k]: v }`
   * 每次都新建对象，`Object.is` 判不出相等，同值也会触发重渲染。 */
  const write = useCallback((key: string, next: number) => {
    setProgress((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
  }, []);

  const report = useCallback(
    (key: string, next: number) => {
      if (!mountedRef.current) {
        return;
      }
      if (!Number.isFinite(next)) {
        return;
      }
      const now = Date.now();
      if (tickMs <= 0 || now - (lastAtRef.current[key] ?? 0) >= tickMs) {
        lastAtRef.current[key] = now;
        write(key, next);
      }
    },
    [tickMs, write],
  );

  const flush = useCallback(
    (key: string, next: number) => {
      if (!mountedRef.current) {
        return;
      }
      lastAtRef.current[key] = Date.now();
      if (!Number.isFinite(next)) {
        return;
      }
      write(key, next);
    },
    [write],
  );

  const clear = useCallback((key?: string) => {
    if (!mountedRef.current) {
      return;
    }
    if (key === undefined) {
      lastAtRef.current = {};
      setProgress({});
      return;
    }
    delete lastAtRef.current[key];
    setProgress((prev) => {
      if (!(key in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return { progress, report, flush, clear };
}

/**
 * 只判「这一帧该不该写」的节流闸门 —— 给值不是数字的进度形态用。
 * 画布镜头进度带 `label`、`use-character-portrait` 要经「焦点还是不是这个角色」的域判据，都套不上上面两个 hook，但都需要同一件事：高频回调里判断「现在该不该写」。
 * 本函数把那半条判据摘出来（窗口 + 按条目独立窗口），不做任何 state 操作：调用处拿到 `true` 才写自己的状态。用法：`const gate = createThrottleGate()`，回调开头 `if (!gate.allow(shot.id)) return;`。与上面两个 hook 共用 {@link PROGRESS_THROTTLE_MS}。
 */
export type ThrottleGate = {
  /**
   * 这一条在这一刻该不该写。
   *
   * `tickMs <= 0` 时恒为 `true`（显式不节流）；`key` 省略时全表共用一个窗口。
   */
  allow: (key?: string, tickMs?: number) => boolean;
  /** 清掉某一条的窗口（或不传 `key` 时清全部）—— 开始新一轮任务前调。 */
  reset: (key?: string) => void;
};

/** 造一个节流闸门（见 {@link ThrottleGate}）。 */
export function createThrottleGate(): ThrottleGate {
  let lastAt: Record<string, number> = {};
  return {
    allow(key = "", tickMs = PROGRESS_THROTTLE_MS) {
      if (tickMs <= 0) {
        return true;
      }
      const now = Date.now();
      if (now - (lastAt[key] ?? 0) < tickMs) {
        return false;
      }
      lastAt[key] = now;
      return true;
    },
    reset(key) {
      if (key === undefined) {
        lastAt = {};
      } else {
        delete lastAt[key];
      }
    },
  };
}
