## Fixed

- **左侧栏底部「设置」被全局状态栏盖住、显示不全**：`BrowserStatusBar` 是
  `fixed bottom-0 h-6`（24px、横跨整窗、z-[10000]），而侧栏由 `SidebarProvider` 的
  `min-h-svh` 撑满整屏，底部 `SidebarFooter` 的「设置」正好落在这 24px 之下被盖住
  （主内容此前已靠 `ShellTabs` 的 `pb-6` 避让，侧栏漏了）。给 `SidebarFooter` 加
  `pb-6`（24px）留白，口径与主内容 / `ScriptMarkdownEditor` 一致；状态栏只在主应用页签
  显示、而侧栏也只在主应用页签可见，故不会在非主页签留下多余空白。
