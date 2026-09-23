## Added

- **落地 `AppShell` + `TopBar` + `CommandPalette` 三个壳层组件**：规范 §12.1 目录树与 §12.2 barrel 示例里一直写着 `AppShell` / `TopBar` 两个名字，但文件从未落地。`CommandPalette` 是本轮补上的「全局搜索（⌘/Ctrl+K）」入口 —— 此前压住没做，是因为它要 `command` 基元，而那批基元在 #886 才合并（现已成为 master 的一部分）。

  - `AppShell` = 官方 `SidebarProvider` + `Sidebar collapsible="icon"` + `SidebarInset`，是 `NAV_ITEMS` 的**唯一**渲染者；侧栏开合态走 cookie（服务端读出来经 `defaultOpen` 回传，首屏即用户上次那档）、⌘/Ctrl+B 与「输入框里不抢键」由 `ui/sidebar` 内部走 `useHotkey`。
  - `TopBar` = `SidebarTrigger`（在 `collapsible="icon"` 下切换的正是「宽栏 ↔ 图标档」，即布局切换）+ 当前视图标题 + 搜索按钮（⌘K 打开面板）+ 应用菜单（设置 / 我的作品）。消息入口复用状态栏那个 `MessageCenterButton`，不再自绘铃铛。
  - `CommandPalette` = `command` 基元的 `CommandDialog` + `CommandInput` + `CommandList` + `CommandItem`，目前收纳「切换视图」命令（数据源 `NAV_ITEMS`，与侧栏同一份）。走基元而非 `Dialog` + 自绘列表，否则撞 P11（自绘浮层选项列表）。

## Changed

- **两套侧栏统一成一套**：此前是「`WorkspaceNav` 自绘的 64px 竖排导航条（非首页视图）+ `HomePage` 内联侧栏与占位顶栏（首页）」两套形态 —— `NavItems.tsx` 的注释里自己写着「两处的唯一事实来源」，而两处都不具备官方基元已有的能力（折叠成图标档 / ⌘B / 记忆）。现在侧栏只有一处渲染者：`WorkspaceNav.tsx` 删除，`WorkspaceView` 的 re-export 改由 `NavItems` 直出。

- **首页顶栏那排占位控件清掉**：搜索框此前是个 `<div>`（连 input 都不是）、铃铛与头像只弹一句 `toast.info` —— 与 `TopBar` 重复且是假实现。移除后 `HomePage` 的 `activeNav` / `onOpenSettings` 两个 prop 不再需要，`Bell` / `Search` / `useToast` 三个 import 一并清掉。

- **`HomePage` 的内容容器从 `<main>` 改成 `<div>`**：外壳的 `SidebarInset` 才是本页唯一的 `<main>`（规范 06 语义标签要求），嵌套两个会破坏地标导航。

- **`VideoQueueModal` 两份同构实例合并为一处**：此前 home 与非 home 两个分支各挂一份。
