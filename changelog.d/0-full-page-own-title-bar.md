## Fixed

- **错误页 / 404 / 全局错误 / 挂载加载态 / 登录页在桌面壳里不再弄丢窗口按钮**
  （ISSUE #1794 复发）：这些整屏路由页是路由段 boundary，一显示就替换掉
  `app/layout` 的整个 children —— `ShellTabs` 连同 `TitleBarTabs`（页签 +
  最小化 / 最大化 / **关闭**）整个卸载。上次修复的 `top-title-bar` 让位的是一条
  不在 DOM 里的标题行，按钮不是被盖住、是整排消失，而「页面出错了」的时刻往往
  正是用户唯一想关窗的时刻。现在这些页面**自带**精简标题行：新增
  `components/studio/WindowTitleBar`（拖拽区 + 三个窗口按钮，无页签，复用
  `window-controls-client` / `title-bar-derive` 判据，自带 `TooltipProvider`
  供 global-error 用）与 `components/studio/ShellFullPage`（`data-shell` +
  标题行 + 自滚内容区）；浏览器 / dev 形态不渲染标题行（系统窗口自带），
  行为与从前一致。
