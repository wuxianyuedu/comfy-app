## Changed

- **视图说明问号统一移到顶栏视图标题右侧，不再重复屏名**：`HeaderHelp` 拆成
  `ui/header-help` 全库唯一实现（按钮 `icon-sm`、图标 20px），各视图那句「偶尔才
  需要读」的解释收进 `studio/ViewHelp.tsx` 的 `viewHelp()` 注册表（历史 / 队列 /
  模型 / 资源库 / 控制台 / 模型适配 / 模式契约），由 `TopBar` 渲染在当前视图标题
  右侧；没有登记的视图不渲染问号。屏内 `PageHeader` 因此回到 `srTitle` 档 ——
  屏名只由页签与顶栏给出，不再一屏两个名字、也不再有第二颗问号（ISSUE #1693）。
  `/models` 独立路由页不在 `AppShell` 里、没有顶栏，其说明仍走页头 `help`。
