## Added

- **`src/components/ui/use-interval.ts` 新增 `pauseWhenUnfocused` 选项，桌面壳场景
  补上「窗口失焦即暂停轮询」的判据**：WebView2 里窗口被别的窗口遮挡但未最小化
  时，`document.visibilityState` 仍报 `visible`、`visibilitychange` 不触发，全库
  15 处轮询会**白拉**——用户切回来时看到的是几秒前的状态而非目光回到窗口那一刻
  的实况。补上 `document.hasFocus()` 判据 + `window.focus/blur` 事件；默认跟随
  `isDesktopShell()`（桌面壳里默认开、浏览器 tab 里默认关——切焦点到别的窗口时
  用户可能仍希望页面在跟新，例如挂着看长任务进度，浏览器场景保留既有语义）。
  显式传 `pauseWhenUnfocused: true/false` 可越过默认。测试加两条：桌面失焦停、
  重新聚焦补跑；`pauseWhenUnfocused: false` 时失焦仍跑。既有 7 条用例全过。
