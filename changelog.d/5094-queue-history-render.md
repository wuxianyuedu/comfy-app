## Fixed

- **队列 / 历史页帧率（#5094）**：两页的长列表改为窗口化渲染（复用 `useVirtualizer` +
  `DocumentFrame` 滚动锚），队列只挂视口附近的行、历史只挂视口附近的一行卡片，未量测时
  回退全量渲染。历史大列表不再挂 `useAutoAnimate` 的 FLIP 观察器，4s 轮询内容不变时
  沿用同一份任务数组引用，避免 100 张已 memo 的卡片整批失效。队列 controller 不再依赖
  每秒变化的 `elapsedMs`，耗时文案下沉到跑动卡本地秒表；行级回调收敛为稳定 handler，
  行组件与视图做 `memo`，左树 controller 与「今天」口径也改为稳定引用。
