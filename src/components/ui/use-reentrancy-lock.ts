"use client";

// ── 「同一个动作正在跑时，第二次调用该怎么办」的唯一出口（规范 16 §16.2.4.69）──
//
// 按**形态**扫出来的账：全库有 40 处「一次异步动作里先置忙碌位、跑完再复位」
// 的执行态，而其中**三处**额外写了一行防重入：
//
//   · `use-copy-feedback` 的 `pendingRef`（两种调用形态共用一条判据）；
//   · `use-external-action` 的 `busyRef`（注释里写着「`setBusy(true)` 还没提交，
//     第二次调用读到的 `busy` 仍是 `false` —— 那正是「双击发两次请求」的成因」）；
//   · `use-encapsulation-test-run` 的 `runningRef`（连点两下会再发一次生成）。
//
// 而其余各处**靠读 state 判**：`if (busy) return;` / `if (loading) return;` /
// `if (batchRunning) return;` —— 那是一个**异步**判据。React 的 `setState`
// 不会立刻改掉本次事件回调里读到的值，于是「同一次事件循环里的两次点击」
// 两次都读到 `false`，两次都发出去。差别不是风格，是**双击会不会跑两遍同一件事**：
//
//   · 复制按钮双击 → 两次剪贴板写入（用户看不出来）；
//   · 「测试连接」双击 → 两次真实模型调用（**花两次钱**）；
//   · 批处理双击 → 两轮串行批处理同时在跑（产物互相覆盖）；
//   · 上传双击 → 同一份文件落两份，第二份覆盖第一份。
//
// 也就是说 —— **「同一条能不能重复点」取决于它是哪一处写的**。这类差异没有
// 报错、没有告警，tsc / eslint 也都不看（`if (busy) return;` 是到处都在用的
// 合法写法，且它在「两次点击之间隔了一次渲染」时确实有效）。
//
// ## 与相邻出口的分工
//
// | 出口 | 回答的问题 |
// | ---- | ---------- |
// | 本模块 | **同一时刻只跑一件**（重入判据，同步可见） |
// | `useItemAction` | 一屏里**哪一条**在忙（按键记账，视图据此禁用） |
// | `runAsyncAction` | 这次动作**说什么**（成功 / 失败文案与通道） |
//
// 前两者**不是二选一**：`useItemAction` 的忙标记是「按条目」的界面执行态，
// 本模块是「跨条目、跨组件实例」的单飞闸门。`use-copy-feedback` 与
// `use-external-action` 各自都有忙标记，也仍然需要本模块 —— 它们的忙标记
// 是给界面看的，重入判据是给并发看的。
//
// ## 为什么不收「忙碌位」

import { useCallback, useRef } from "react";

/**
 * 一把同步可见的单飞闸门。
 *
 * `tryEnter()` 与 `exit()` 是**同步**的：第一次调用拿 `true`，之后的调用在
 * `exit()` 之前一律拿 `false`。它表达的是「这一刻这件事是不是已经在跑了」，
 * 而 `useState` 的忙碌位表达的是「界面该显示成什么样」—— 前者不能是异步的。
 */
export interface ReentrancyLock {
  /**
   * 尝试进入临界区：已经在跑时返回 `false`（调用处直接 `return`），
   * 拿到 `true` 的那一次**必须**在结束（成功 / 失败 / 提前返回）时调
   * {@link ReentrancyLock.exit}。
   */
  tryEnter: () => boolean;
  /** 离开临界区 —— 必须在 `finally` 里调（提前 `return` 的分支也要走到）。 */
  exit: () => void;
  /** 当前是否在临界区里（只读，给「要不要禁用按钮」这类展示判断用）。 */
  isLocked: () => boolean;
}

/**
 * 就地造一把闸门（模块级 / 组件级都能用）。
 *
 * 用在**跨组件实例**的单飞场景（同一件事可能从两个入口发起），或
 * 不想/不能引 hook 的地方（服务端编排、类组件、测试）。
 */
export function createReentrancyLock(): ReentrancyLock {
  let locked = false;
  return {
    tryEnter: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
    exit: () => {
      locked = false;
    },
    isLocked: () => locked,
  };
}

/**
 * 组件级别的闸门（引一次 `useRef`，`strict mode` 下重挂即重来）。
 *
 * 用法：先在动作开头 `const lock = useReentrancyLock()` 拿一把闸门；
 * 动作体第一行用 `if (!lock.tryEnter()) return` 抢占 —— 抢不到就直接返回
 *（双击时第二次走这一步）；抢到的那一次在 `finally` 里调 `lock.exit()` 归还。
 * 忙碌位仍然由调用处管（界面要用它），两者是两件事。
 *
 * 两条刻意的口径：
 *
 * 1. **不接管忙碌位** —— 界面上「忙」的表现形态各不相同（按钮禁用、转圈、
 *    行内文案、进度表），而重入判据只有一条。把两者揉在一起会让「不需要
 *    忙碌位、只需要单飞」的落点（批处理、服务端编排）被迫重建一份界面状态；
 * 2. **`tryEnter` 与 `exit` 分开，不提供 `run` 包装** —— 包装形态
 *    （`lock.run(async () => …)`）在「已经在跑时该返回什么」上必然要替调用处
 *    做一个决定（返回 `undefined`？原 Promise？），而三处落点的答案不同
 *    （`use-copy-feedback` 返回 `false`、`use-external-action` 直接 `return`、
 *    `use-encapsulation-test-run` 返回 `undefined`）。闸门只回答「进不进得去」，
 *    这个决定留在调用处。
 *
 * 刻意**不做**：
 *
 * · **不排队**（第二次调用直接丢弃，不押后重跑）—— 用户连点的意图是「再来一次
 *   同一件事」，而前一次还在跑时重跑一次只会产出两份等价结果；
 * · **不做引用计数** —— 一次只有一个持有者，多持有者要的是另一套语义
 *   （池 / 队列），那不属于这条账。
 */
export function useReentrancyLock(): ReentrancyLock {
  /* ref 是同步写入的 —— 这正是本出口存在的全部理由：`useState` 的忙碌位在
   * 同一次事件循环里读不到刚写进去的值（React 只在提交后才更新它）。 */
  const lockedRef = useRef(false);
  const tryEnter = useCallback(() => {
    if (lockedRef.current) return false;
    lockedRef.current = true;
    return true;
  }, []);
  const exit = useCallback(() => {
    lockedRef.current = false;
  }, []);
  const isLocked = useCallback(() => lockedRef.current, []);
  return { tryEnter, exit, isLocked };
}
