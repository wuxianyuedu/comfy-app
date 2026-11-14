## Fixed

- **前端两处事件订阅非幂等**（ISSUE #3834）：
  - `LogProvider` 的 Tauri `log:emit` 订阅：React StrictMode 双挂载时，第一次
    cleanup 跑在 `import("@tauri-apps/api/event")` 完成之前、`unlisten` 还没到手，
    第一条监听器就此泄漏、壳日志被处理两次。改用 `cancelled` 标志 —— 「清理先于
    注册完成」的那次订阅在到手后立刻退订。
  - `useDraggablePosition`：拖拽期挂到 `window` 的 pointermove / pointerup /
    pointercancel 三个监听器原先只随用户松手摘除，组件在拖拽中被卸载（切页签 /
    条件渲染收起悬浮控件）即泄漏。现在退订句柄进 ref，卸载时统一摘除。
