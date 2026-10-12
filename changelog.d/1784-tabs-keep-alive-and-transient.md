## Changed

- **视图页签现在真的「保持打开」**（ISSUE #1784 第 1 条，用户原话：*上面页签的意义就是让打开的界面保持打开，而不是切换过去再重新打开*）。`workspace/page.tsx` 原先用 `switch (viewMode)` 只渲染当前那一屏，切走即卸载 —— 切回画布是一张重开的空网、控制台里跑着的长命令断连、工坊草稿没了。现在按**页签列表**逐屏取内容、叠在一起用 CSS 显隐切换（`hidden` + `h-full`，与壳页签 `ShellTabs` 对 iframe 同一套），卸载只发生在**真的关掉那一页**时。
  - 逐屏渲染与十二份 `next/dynamic` 懒加载声明一并收进新组件 `src/components/studio/WorkspaceViewStack.tsx`（页面那个函数已在 §12.13 的 400 行阈值附近，且「哪一屏对应哪个组件」与懒加载是同一条知识）。
  - 每页 wrapper 带 `data-view="<视图>"`（e2e 用它判「切走的那一页仍挂载」），非当前页补 `aria-hidden`。

- **设置 / 模型适配 / 模式契约改成「瞬时页签」：切走即关，不常驻**（ISSUE #1784 第 2 条，*这里有些项其实不需要保持打开，那些打开的标签随着切换关闭就行*）。`NavItem` 新增 `transient` 标记；`workspace-tabs.ts` 立下不变式**「最多只有当前页可以是 transient」**，开新页 / 切页 / 关页三条入口统一跑 `withTransientPruned`（新增 `focusViewTab` 承载「切页」这条，与「开新页」分开）。
  - 判据为什么是「语义」不是「实现」：这三屏是**读过即走的配置屏**（改一项、看一眼、就走），没有值得跨切换保住的编辑态；而「切走的那一页还在列表里」这件事在状态层就不可能出现，不依赖任何渲染时序。
  - 瞬时页签**不落盘**（`serializeWorkspaceTabs` 剔除），当前页恰是它时 `activeKey` 改指首页 —— 否则存下来的 `activeKey` 指向一个不在列表里的页，`parseWorkspaceTabs` 会按「整份不可信」丢弃全部页签，用户在一次冷启动里丢掉所有常驻页，只为当时正停在设置上。

- **两个侧栏「设置」入口撤掉，入口收归顶栏应用菜单**（ISSUE #1784 第 3 条，*左侧这两个设置都去掉，右上角哪里已经有入口了*）。原先侧栏列表里、侧栏底部各有一项，顶栏应用菜单里还有一项 —— 一个动作三处入口。
  - 新增 `sidebarNavItems()`：与 `globalNavItems()` 只差「侧栏隐藏」这一项。刻意不收在 `globalNavItems()` 上 —— 那个出口还有两个消费者（页签条「+」菜单、命令面板搜索），收在上面会把设置一起从那里删掉，变成只有顶栏一个入口的孤岛。
  - `SidebarFooter` 随之删除（顺带不再需要为底部状态栏 24px 让位的 `pb-6`）。撤的是入口不是能力：`onOpenSettings` 仍由 `AppShell` 转给 `TopBar`。

## Tests

- `src/components/studio/workspace-tabs.test.ts` 新增「瞬时页签：切走即关」一组 7 条：三项是 transient 而画布 / 工坊 / 模型不是、从设置切到别页时设置退场而不动常驻页、切回不产生第二页、`focusViewTab` 退场的是被切走的那一页、指不存在的键原样返回、手动关掉后落左邻、不落盘且当前页为它时 `activeKey` 改指首页。
- `src/components/studio/nav-items.test.ts` 新增两组「产品判断」判据：恰好那三项是瞬时、只有设置不在侧栏列表里且侧栏与全局项只差这一项。
- `src/components/studio/AppShell.sidebar-view-entry.test.tsx` 新增一组：侧栏里没有「设置」、`SidebarFooter` 不再出现、`onOpenSettings` 仍传给顶栏。
- `e2e/view-tabs.spec.ts` 新增「切走的那一页仍然挂载」：三个 `[data-view]` wrapper 都在 DOM 里、当前页可见另两页隐藏、切回拿到的是**同一个元素**（重新挂载会让旧 handle detached）。
- `e2e/settings-view.spec.ts` / `e2e/critical-flows.spec.ts` 改走新的唯一入口 `e2e/support/settings-entry.ts`（顶栏应用菜单 → 设置），并把「切回首页后设置那一页还在」的旧断言反过来判「它退场了」。
