## Fixed

- **历史页不再每 1.5s 全量重渲染**（#4559）：只要有任一任务在 RUNNING，
  进度定时器每拍都会换 `progressMap` 的引用，而任务卡片没有 memo 短路 ——
  「加载更多」累积多页后，几十上百张内容没变的静止卡每拍陪跑一次整树 diff。
  三处同批收口：`HistoryTaskCard` 包 `React.memo`（静止卡的 props 引用与值都稳定）；
  `useSimulatedProgress` 只在**真的有值变化**时才换 `map` 引用（RUNNING 卡封顶 95%
  之后不再造新对象）；页面不可见时暂停模拟进度（`pauseWhenHidden` 回归仓内轮询的
  默认口径，后台标签页不再空转）。
