## Changed

- **主页侧栏导航重构：项目相关视图不再随当前视图漂移显隐，「项目」下沉为底部可展开分组，画布/工坊/产出/成片 收进「项目界面」顶部标签页**：
  此前侧栏用 `visibleNavItems(active)` 在「首页 vs 非首页」之间切换画布/工坊/产出/成片 的显隐——
  点「项目」等任一非首页视图，这四项就莫名复现；点首页又消失（用户反馈的抖动）。根因是「显隐」被绑到了
  「当前是不是首页」这条会变的判据上，而不是「这一项属于哪个界面」。改成按分区归属一次性定型：
  - `NavItems.tsx` 拆成三个分区并导出 `globalNavItems()` / `projectTabs()` / `isProjectTab()` /
    `PROJECTS_ENTRY`，移除 `visibleNavItems`。全局项（首页/模型/历史/炼丹/流程）常驻侧栏顶部；
    画布/工坊/产出/成片 标 `projectScoped`、只进项目界面顶部标签栏；`works`（项目）作底部入口。
  - `AppShell.tsx`：顶部只渲染全局项；底部新增「项目」分组（用 `ui/disclosure` 的 `Disclosure`，
    遵守 P10 不自绘折叠开关），展开列出已有项目（高亮当前活跃项）+「查看全部」+「新建项目」，
    `mt-auto` 顶到侧栏最下；图标档折叠时整组隐藏。
  - 新增 `ProjectTabBar.tsx`：项目界面顶部用官方 `ui/tabs` 渲染 画布/工坊/产出/成片 切换器（受控于当前视图）。
  - `workspace/page.tsx`：给 `AppShell` 传 projects/activeProjectId/onOpenProject/onShowAllProjects/onNewProject；
    进入某项目 → 画布为默认页签 + 顶部标签栏切换；项目闸门（`ProjectGate`）条件由 `isProjectTab` 统一，
    补上「产出」（此前只 gate 画布/工坊/成片）。`CommandPalette` 改列 全局项 + 项目页签。
  - 效果：主页侧栏只剩全局工具 + 底部「项目」列表（可展开/折叠、支持直接选项目进项目界面）；
    项目内的 画布/工坊/产出/成片 通过顶部标签切换，不再在左侧主列表反复出现/消失。

## Tests

- `nav-items.test.ts` 重写为分区断言（全局项不含项目页签/入口、四页签互斥、全量=三分区无重无漏）；
  新增 `ProjectTabBar.test.tsx`（渲染四页签、当前项高亮、点击回抛视图 id、显示项目名）。
