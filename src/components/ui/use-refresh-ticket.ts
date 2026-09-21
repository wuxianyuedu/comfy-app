"use client";

// ── 「按需求重新跑一遍取数」的唯一出口（规范 16 §16.2.4.70）────────────────
//
// 按**形态**扫出来的账：全库有两处把「刷新」实现成一个自增整数的
// `useState` + 一个 `useCallback(() => setKey((k) => k + 1))`，再把它塞进
// 取数 effect 的依赖数组：
//
//   · `const [reloadKey, setReloadKey] = useState(0)` —— 票号；
//   · `const refresh = useCallback(/* 每次 +1（换一张票） */ () => setReloadKey((key) => key + 1), [])`；
//   · 再把 `reloadKey` 塞进取数 effect 的依赖数组（`[projectId, scope, filter,
//     reloadKey]`）。
//
// 另有一处只**声明**了票号却从不自增（`workspace/page.tsx` 的 `recentsKey`
// 是 `useState(0)` 且没有 setter），注释还写着「自增以重新读取 canvas-store」
// —— 票号忘了接上，而构建与测试都不报。
//
// 三处差异都是静默的：
//
//   · **票据 vs 直接调** —— 「重新跑一遍」可以是「叫取数函数」（`load()`），
//     也可以是「换一个依赖值」（票据）。前者在依赖变化时**不**重跑、后者在
//     渲染期就要多算一次；两者混用会让同一个面板的刷新语义取决于它用哪支。
//     收口后只有一个口径：换依赖值（票据），取数逻辑仍然住在 effect 里。
//   · **初值 / 溢出** —— 三处的初值都是 `0`，但「刷新一次」的判据是**值变了**，
//     不是值变大；用 `Math.random()` 或时间戳当票号会让每一帧都重跑。
//     这里显式钉住「初值 0、每次 +1」。
//   · **要不要暴露当前值** —— 调用处只需要 `ticket` 与 `refresh` 两个东西，
//     收口前每处各写一遍 `useState` 的 setter 与 `useCallback` 的依赖数组
//     （其中一处漏了依赖，于是 `refresh` 的身份每渲染都变，effect 跟着重跑）。
//
// 也就是说 —— **「刷新一次」这件事对三处是三个判据**。这类差异没有报错、
// 没有告警，tsc / eslint 也都不看（`setKey((k) => k + 1)` 是到处都在用的
// 合法写法）。

import { useCallback, useState } from "react";

/**
 * 一张「要求重新跑一遍取数」的票据。
 *
 * `ticket` 放进取数 effect 的依赖数组，`refresh()` 让它自增 —— effect 于是
 * 重跑。这样「什么时候该重新取」只有一个入口，而「怎么取」仍然完整地住在
 * effect 里（不搬走、不复制）。
 */
export interface RefreshTicket {
  /** 票号：放进取数 effect 的依赖数组。调用处**不该**读它的数值。 */
  ticket: number;
  /** 换一张新票（effect 依赖它 → 重跑一次取数）。 */
  refresh: () => void;
}

/**
 * 造一张票据。
 *
 * 取用是三步：先 `const { ticket, refresh } = useRefreshTicket()` 拿到票据；
 * 再把 `ticket` 放进取数 effect 的依赖数组（于是换票就重跑那一轮取数）；
 * 最后把面板上的「重试 / 刷新」按钮接到 `refresh`。
 * 取数逻辑本身仍然完整地住在 effect 里 —— 不搬走、不复制。
 *
 * 两条刻意的口径：
 *
 * 1. **不暴露 setter、不暴露当前值** —— 调用处要的是「重新跑一遍」这个动作，
 *    不是「票号是多少」。暴露 `setTicket` 会让「减一」「设成 5」这类写法出现
 *    （它们表达的都不是「刷新」），暴露数值会让调用处开始用它当缓存键
 *    （那不是本出口的账）；
 * 2. **不做防抖 / 合并** —— 连点两次「重试」发两次取数，这是用户点出来的
 *    意图；要防重入的落点该用 `~/components/ui/use-reentrancy-lock`（那是另一条账，
 *    两者可以并用）。
 */
export function useRefreshTicket(): RefreshTicket {
  const [ticket, setTicket] = useState(0);
  /* 依赖数组为空是刻意的：`setTicket` 的身份在 React 里是稳定的，
   * 而 `setTicket((n) => n + 1)` 的函数式写法不读任何闭包值 —— 于是
   * `refresh` 的身份**恒定**，可以安全地传给 `useEffect` 依赖或子组件 props。
   * 收口前有两处把 `refresh` 写进了 `useCallback`，其中一处漏了依赖。 */
  const refresh = useCallback(() => setTicket((n) => n + 1), []);
  return { ticket, refresh };
}
