"use client";

// ── 「同一个动作正在跑时，第二次调用该怎么办」的唯一出口（规范 16 §16.2.4.69）──
// 全库 40 处执行态里只有 3 处额外写了防重入（pendingRef / busyRef / runningRef），其余靠 `if (busy) return;` 判 —— setState 异步，同一事件循环里的两次点击都读到 false，于是双击跑两遍（复制、测试连接花两次钱、批处理产物互覆、上传落两份）。
// 与邻居分工：本模块答「同一时刻只跑一件」（同步可见）；`useItemAction` 答「哪一条在忙」（界面执行态）；`runAsyncAction` 答「这次说什么」。前两者不是二选一，忙标记给界面看、重入判据给并发看。

import { useCallback, useRef } from "react";

/**
 * 一把同步可见的单飞闸门。
 * `tryEnter()` / `exit()` 是同步的：第一次拿 `true`，`exit()` 之前一律 `false`。它表达「这一刻是否已在跑」，与 useState 的忙碌位（界面该显示成什么样）不同，前者不能异步。
 */
export type ReentrancyLock = {
  /** 离开临界区 —— 必须在 `finally` 里调（提前 `return` 的分支也要走到）。 */
  exit: () => void;
  /** 当前是否在临界区里（只读，给「要不要禁用按钮」这类展示判断用）。 */
  isLocked: () => boolean;
  /**
   * 尝试进入临界区：已经在跑时返回 `false`（调用处直接 `return`），
   * 拿到 `true` 的那一次**必须**在结束（成功 / 失败 / 提前返回）时调
   * {@link ReentrancyLock.exit}。
   */
  tryEnter: () => boolean;
};

/**
 * 就地造一把闸门（模块级 / 组件级都能用）。
 * 用于跨组件实例的单飞（同一件事可能从两个入口发起），或不想/不能引 hook 的地方（服务端编排、类组件、测试）。
 */
export function createReentrancyLock(): ReentrancyLock {
  let locked = false;
  return {
    tryEnter: () => {
      if (locked) {
        return false;
      }
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
 * 用法：动作开头 `const lock = useReentrancyLock()`；动作体第一行 `if (!lock.tryEnter()) return`，抢到的在 `finally` 里 `lock.exit()`。忙碌位仍由调用处管，两者是两件事。
 * 刻意两条：① 不接管忙碌位（界面「忙」形态各异，把两者揉一起会让只需单飞的落点被迫重建界面状态）；② tryEnter/exit 分开、不提供 `run` 包装（「已在跑时返回什么」三处答案不同，闸门只答「进不进得去」）。也不排队、不做引用计数。
 */
export function useReentrancyLock(): ReentrancyLock {
  /* ref 是同步写入的 —— 这正是本出口存在的全部理由：`useState` 的忙碌位在
   * 同一次事件循环里读不到刚写进去的值（React 只在提交后才更新它）。 */
  const lockedRef = useRef(false);
  const tryEnter = useCallback(() => {
    if (lockedRef.current) {
      return false;
    }
    lockedRef.current = true;
    return true;
  }, []);
  const exit = useCallback(() => {
    lockedRef.current = false;
  }, []);
  const isLocked = useCallback(() => lockedRef.current, []);
  return { tryEnter, exit, isLocked };
}
