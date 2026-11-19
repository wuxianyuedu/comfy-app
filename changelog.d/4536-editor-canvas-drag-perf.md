## Fixed

- 工作流编辑器画布**拖动节点掉帧**（诉求现场降到 ~20fps，#4536）：节点 / 连线状态从编辑器组件的受控 `useState`（`useNodesState` / `useEdgesState`）迁入 React Flow 自身 store（非受控画布 + `rf.setNodes` / `rf.setEdges` 同步图数据）。此前拖拽的每一帧位置更新都会经 `onNodesChange → setNodes` 把整个编辑器树（顶栏 / 浮层 / 画布外壳 / React Flow）重渲染一遍；现在逐帧更新只发生在 React Flow 内部 store（按节点订阅，仅被拖节点重渲染），拖拽帧率不再随图变大而崩。取证（60 节点夹具、无头 Chromium 真实鼠标拖动）：拖拽期主线程脚本耗时每秒 0.805s → 0.610s（-24%）、任务耗时 0.965s → 0.773s（-20%），且收益随图增大而扩大；拖拽功能回归验证通过（拖动真实位移 + 落盘路径不变）。
