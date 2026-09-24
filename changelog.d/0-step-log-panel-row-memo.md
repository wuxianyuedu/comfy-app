## Fixed

- **步骤日志弹窗每次重渲染都要重建整屏行（`src/components/studio/project-canvas/GlobalStepLogPanel.tsx`）**：
  弹窗最多同时挂 300 行（每行 4~5 个 span，约 1500 个 DOM 节点），行此前是写在面板里的
  内联 JSX —— 面板一重渲染就整屏重建，而触发源有两个：画布每帧、SSE 每来一条日志。
  现在行抽成 `StepLogRow` 并用 `memo` 包住（追加日志时缓存做的是 `[...prev.logs, entry]`，
  已有条目引用不变，因此只有新行真正渲染），级别配色与时刻格式化一并收进该组件。
- **面板未打开时 `useNodes()` 订阅依旧生效**：面板在 hooks 之后才 `return null`，画布
  拖拽 / 平移每帧都会带着它重渲染一次。订阅随「任务切换器」下沉到新的
  `StepLogTaskPicker`（序号只在那里用得到），面板未打开时它根本不挂载。
