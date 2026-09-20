"use client";

// ── 「把一次进度回调节流后写进 state」的唯一出口（规范 16 §16.2.4.68）──────
//
// 按**形态**扫出来的账：`watchTask` 的 `onProgress` 是**高频**回调 ——
// SSE 每收到一帧进度就调一次，一次生成可以调几百次。而它被直接接到
// `setState` 上，全库 **6 处**各写一遍，写法看着都对：
//
//   · `VideoStudio`    —— 回调里直接以 `shotId` 为键展开进度表
//   · `ShotStudio`     —— **逐字相同**的一行（两个文件的这一段完全一样）
//   · `use-workshop-pipeline` —— 同一形状，值多带一个 `label`
//   · `use-character-portrait` —— 同一形状，但只在「焦点还是这个角色」时才写
//   · `use-workflow-run-resume` —— 经过一层 handlersRef 转发
//   · `use-encapsulation-test-run` —— 直接 `setProgress(pct)`
//
// 差别不在「怎么写这一行」，而在**三个从未被写下来的决定**上：
//
//   · **多久写一次** —— 六处**没有一处节流**。一帧进度一次 `setState`，
//     而 React 的批处理只合并**同一个事件循环内**的更新；SSE 帧是宏任务，
//     每一帧都会引发一次独立渲染。生成期间面板的重渲染次数与任务时长成正比；
//   · **写进去的是不是同一个值** —— `{ ...prev, [shotId]: p }` 无条件新建
//     对象：`p` 与上一次相同时**照样**触发重渲染（React 只在 `Object.is`
//     相等时才跳过，新对象永远不等）；
//   · **卸载之后还写不写** —— 六处里没有一处带守卫。`watchTask` 返回的
//     `close` 由调用处负责，而「组件卸载时有没有调到它」是另一件事：
//     漏了就是「在已卸载组件上 setState」（React 18+ 不再告警，静默）。
//
// 因此本出口一次给全三件：**节流窗口**（同窗口内只取最后一次的值）、
// **同值短路**（写进去的值与上一次相同就不落 state）、**卸载守卫**
//（卸载后到达的回调直接丢弃）。
//
// ## 为什么是「节流」而不是「防抖」
//
// 进度是**单调推进的读数**：用户要看到它动。防抖会推迟到「安静下来之后」
// 才写，而进度条恰好在一直不安静时最需要更新。节流（首帧立即、之后按窗口
// 采样）保证「读数不会落后超过一个窗口」，同时把写入次数压到可预期。
//
// ## 与邻居的分工
//
// | 出口 | 回答的问题 |
// | ---- | ---------- |
// | `watchTask` / `useInterval` | **多久来一次**（订阅与轮询的起停） |
// | 本出口 | **多久写一次 state**（高频读数 → 界面） |
// | `~/lib/progress` | 这个数是**几**（夹取与比例换算） |
// | `ProgressBar` | 这个数**长什么样**（形态） |
//
// 四者配合使用，不互相替代。

import { useCallback, useEffect, useRef, useState } from "react";

/** 进度节流的默认窗口：约等于「一秒 10 帧」，肉眼已是连续推进。 */
export const PROGRESS_THROTTLE_MS = 100;

export interface ThrottledProgress {
  /** 最近一次落进 state 的读数（首帧前为 `initial`）。 */
  value: number;
  /**
   * 节流后的写入器 —— 直接交给 `onProgress`。
   *
   * 同一个窗口内的多次调用**只保留最后一次的值**（进度是累计读数，
   * 中间值没有意义，丢掉不损失信息）。
   */
  report: (value: number) => void;
  /** 立刻写入并解除节流（任务落定时调 —— 终值不允许被窗口吃掉）。 */
  flush: (value: number) => void;
  /** 复位（开始新一轮任务前调，回到 `initial`）。 */
  reset: () => void;
}

/**
 * 把高频进度回调节流后写进 state（**单值**：一次只跑一个任务）。
 *
 * 用法：先 `const pct = useThrottledProgress(0)`，再在订阅回调里把进度交给
 * `pct.report(p)`、落定时 `pct.flush(100)`。
 *
 * `tickMs` 取 {@link PROGRESS_THROTTLE_MS}；传 `0` 表示不节流（逐帧写），
 * 那是**显式**决定 —— 只在「读数必须逐帧精确」时用。
 *
 * ⚠️ 落定时**必须**调 `flush`：节流会在窗口边界上丢掉最后一次读数，
 * 而进度条停在 97% 而任务已经完成，正是「窗口把终值吃掉了」。
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
      if (!mountedRef.current) return;
      if (!Number.isFinite(next)) return;
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
    if (!mountedRef.current) return;
    lastAtRef.current = Date.now();
    if (!Number.isFinite(next)) return;
    setValue((prev) => (prev === next ? prev : next));
  }, []);

  const reset = useCallback(() => {
    lastAtRef.current = 0;
    if (!mountedRef.current) return;
    setValue(initial);
  }, [initial]);

  return { value, report, flush, reset };
}

/**
 * **按条目**的进度节流表 —— 「一个列表里多条同时在跑」的形态。
 *
 * 工坊的镜头台（`VideoStudio` / `ShotStudio`）与画布流程（`use-workshop-pipeline`）
 * 此前各写一份 `Record<string, number>` 的进度表，且**两处逐字相同**
 *（收口前的写法是「一个 `Record<string, number>` 的 state + 回调里以条目 id
 * 为键无条件展开」—— 见本文件开头那张表的第一行）。
 *
 * 与单值版的差别有三处，都是**语义**上的：
 *
 *   · **窗口按条目独立** —— 三条镜头同时在跑时，用同一个窗口会让先报的那条
 *     把后报的那条挤掉（读数变得随机取决于谁先来）。这里按 `key` 各记一个
 *     时间戳；
 *   · **完整度判据按条目** —— `clear(key)` 一条跑完就清，否则进度表会随会话
 *     越积越长（收口前的写法是整表复位，于是「重跑一条」会把**别的**条目的
 *     进度一起抹掉）；
 *   · **同值不换对象** —— 收口前无条件展开新对象，同值也会触发重渲染。
 *
 * 返回的 `progress` 是 `Record`，调用处的读法（`progress[shot.id] ?? 0`）不变。
 */
export interface ThrottledProgressMap {
  /** 各条目最近一次落进 state 的读数。 */
  progress: Record<string, number>;
  /** 节流后的写入器 —— 直接交给 `onProgress`。 */
  report: (key: string, value: number) => void;
  /** 立刻写入并解除该条目的节流（落定时调）。 */
  flush: (key: string, value: number) => void;
  /** 清掉某一条（或不传 `key` 时清全部）。 */
  clear: (key?: string) => void;
}

/**
 * 按条目的进度节流表。
 *
 * 用法：先 `const pct = useThrottledProgressMap()`，再在订阅回调里
 * `pct.report(shotId, p)`、落定时 `pct.flush(shotId, 100)`。
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
    setProgress((prev) =>
      prev[key] === next ? prev : { ...prev, [key]: next },
    );
  }, []);

  const report = useCallback(
    (key: string, next: number) => {
      if (!mountedRef.current) return;
      if (!Number.isFinite(next)) return;
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
      if (!mountedRef.current) return;
      lastAtRef.current[key] = Date.now();
      if (!Number.isFinite(next)) return;
      write(key, next);
    },
    [write],
  );

  const clear = useCallback((key?: string) => {
    if (!mountedRef.current) return;
    if (key === undefined) {
      lastAtRef.current = {};
      setProgress({});
      return;
    }
    delete lastAtRef.current[key];
    setProgress((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return { progress, report, flush, clear };
}

/**
 * **只判「这一帧该不该写」的节流闸门** —— 给值不是数字的进度形态用。
 *
 * 工坊画布的镜头进度带一个 `label`（当前节点名），
 * `use-character-portrait` 的进度要经「焦点还是不是这个角色」的域判据 ——
 * 两者都不是「一个数字写进 state」，套不上上面两个 hook。但它们**都要**
 * 同一件事：高频回调里判断「现在该不该写」。
 *
 * 本函数把那半条判据摘出来（窗口 + 按条目的独立窗口），**不做任何 state 操作**：
 * 调用处拿到 `true` 才去写自己的那份状态。
 *
 * 用法：先 `const gate = createThrottleGate()`，再在 `onProgress` 的回调开头
 * `if (!gate.allow(shot.id)) return;`，之后照常写自己那份状态。
 *
 * 与上面两个 hook 共用 {@link PROGRESS_THROTTLE_MS} 的默认窗口 ——
 * 「一秒 10 帧」这条口径只有一处。
 */
export interface ThrottleGate {
  /**
   * 这一条在这一刻该不该写。
   *
   * `tickMs <= 0` 时恒为 `true`（显式不节流）；`key` 省略时全表共用一个窗口。
   */
  allow: (key?: string, tickMs?: number) => boolean;
  /** 清掉某一条的窗口（或不传 `key` 时清全部）—— 开始新一轮任务前调。 */
  reset: (key?: string) => void;
}

/** 造一个节流闸门（见 {@link ThrottleGate}）。 */
export function createThrottleGate(): ThrottleGate {
  let lastAt: Record<string, number> = {};
  return {
    allow(key = "", tickMs = PROGRESS_THROTTLE_MS) {
      if (tickMs <= 0) return true;
      const now = Date.now();
      if (now - (lastAt[key] ?? 0) < tickMs) return false;
      lastAt[key] = now;
      return true;
    },
    reset(key) {
      if (key === undefined) lastAt = {};
      else delete lastAt[key];
    },
  };
}
