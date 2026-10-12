## Changed

- **浏览器 / dev 形态下视图页签条上移到内容列最顶端**：`AppShell` 把 `ViewTabStrip`
  从 `TopBar` 下方移到 `TopBar` 上方（仍保留在 `SidebarInset` 内部，由 fixed 侧栏
  自然让位，避免被侧栏压住页签关闭按钮）。桌面壳形态不变，仍由 `TitleBarTabs`
  在窗口标题行承载。效果：浏览器中打开时，已打开的视图页签（首页 / 设置 / 队列 /
  历史 / 模型 …）位于内容区最顶端，而非 `TopBar` 下方。
