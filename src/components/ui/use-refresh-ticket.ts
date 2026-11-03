"use client";

// ── 「按需求重新跑一遍取数」的唯一出口（规范 16 §16.2.4.70）────────────────
// 全库两处把刷新实现成自增整数 + useCallback 塞进取数 effect 依赖；另有一处只声明票号从不自增（`workspace/page.tsx` 的 `recentsKey`，注释写「自增」却没 setter），构建与测试都不报。
// 收口后只有一个口径：换依赖值（票据），取数逻辑仍住在 effect 里。显式钉住「初值 0、每次 +1」；调用处只需要 `ticket` 与 `refresh`，不暴露 setter / 当前值。

import { useCallback, useState } from "react";

/**
 * 一张「要求重新跑一遍取数」的票据。
 * `ticket` 放进取数 effect 的依赖数组，`refresh()` 让它自增 —— effect 重跑。「什么时候该重新取」只有一个入口，「怎么取」仍完整地住在 effect 里（不搬走、不复制）。
 */
export type RefreshTicket = {
  /** 换一张新票（effect 依赖它 → 重跑一次取数）。 */
  refresh: () => void;
  /** 票号：放进取数 effect 的依赖数组。调用处**不该**读它的数值。 */
  ticket: number;
};

/**
 * 造一张票据。
 * 三步：`const { ticket, refresh } = useRefreshTicket()`；把 `ticket` 放进取数 effect 依赖数组；把「重试 / 刷新」按钮接到 `refresh`。取数逻辑本身仍住在 effect 里。
 * 两条刻意口径：① 不暴露 setter / 当前值（否则会出现「减一」「设成 5」或拿它当缓存键）；② 不做防抖 / 合并（连点两次是用户意图；要防重入用 `use-reentrancy-lock`，可并用）。
 */
export function useRefreshTicket(): RefreshTicket {
  const [ticket, setTicket] = useState(0);
  /* 依赖数组为空是刻意的：`setTicket` 的身份在 React 里是稳定的，
   * 而 `setTicket((n) => n + 1)` 的函数式写法不读任何闭包值 —— 于是
   * `refresh` 的身份**恒定**，可以安全地传给 `useEffect` 依赖或子组件 props。
   * 收口前有两处把 `refresh` 写进了 `useCallback`，其中一处漏了依赖。 */
  const refresh = useCallback(() => {
    setTicket((n) => n + 1);
  }, []);
  return { ticket, refresh };
}
