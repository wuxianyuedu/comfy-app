## Fixed

- **工作流编辑器：关闭 IO 预览时一并退出「编辑 IO」（ISSUE #400）**。此前两个开关各自独立，关掉预览后节点卡片上的勾选框还留着一排——面板已经没了，作者看到的是一堆无从确认结果的空勾选。现在 `setIoPreviewOpen(false)` 会同时把 `ioEditMode` 关掉，`setIoPreviewOpen(true)` 也会一并进入编辑模式；反方向同样成立（关编辑模式一并关预览）。两个方向都收在 store 动作里，顶栏与画布按钮不再手写 `setState`。已勾选的 IO 结果不受影响。
