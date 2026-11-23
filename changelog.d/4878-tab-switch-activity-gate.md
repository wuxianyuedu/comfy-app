## Changed
- 侧边栏多页签切换掉帧优化（#4878）：视图栈的非活跃降级闸（`HeavyViewGate`，React Activity hidden）从 queue / history / settings 三屏扩到除首页与项目页之外的全部视图。切页时隐藏子树不再做任何 React 渲染，避免 ComfyUI / 工作流库 / 模型适配 / 测试模型 / 模式契约等整棵重渲染。组件内部状态、滚动位置与既有按活跃度暂停的轮询 / SSE 保持不变；项目页（ReactFlow 内部状态）与首页仍常驻，另评。6 视图来回切换的本地取证：>50ms 长帧峰值从 350~450ms 降到 233~317ms，trace 里 `jsxDEV` / effect 遍历不再是热点。
