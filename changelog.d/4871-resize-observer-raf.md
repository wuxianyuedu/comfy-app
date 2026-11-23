## Fixed

- `ResizeObserver` 回调统一经 rAF 隔离一帧（#4871）：观察回调里同步量测 + setState 改布局，会在同一帧里再次触发观察——浏览器打红色「ResizeObserver loop completed with undelivered notifications」（开发面板的 system 错误通道）。新增 `rafResizeObserverCallback`（`~/lib/dom-rect`），替换全仓仅有的两处直接构造（`useElementBox`、`TruncatedText`）；同帧内的再次触发取消前一帧、只执行最后一次。功能无变化（读数下一帧到位）。
