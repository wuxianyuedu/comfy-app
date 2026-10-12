## Changed

- **PageHeader 帮助问号图标统一放大并置于可见标题右侧**：`HeaderHelp` 的按钮从
  `icon-xs` 升到 `icon-sm`，图标本身从默认 12px 调到 20px；全库所有传 `help` 的
  `PageHeader` 调用点同时补传 `title`，让问号始终挂在页头标题右侧，不再落在
  actions 区域。涉及历史、队列、模型库、资源库、控制台、模型适配、模式契约等屏。
