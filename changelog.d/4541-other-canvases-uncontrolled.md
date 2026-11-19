## Fixed

- **项目画布 / 工作流库画布**同款拖拽掉帧修复（#4541，接续 #4536）：两块画布的节点 / 连线状态从受控 `useNodesState` / `useEdgesState` 迁入 React Flow 自身 store（非受控 + `defaultNodes` / `defaultEdges` + `rf.setNodes` / `rf.setEdges`），拖拽的逐帧位置更新不再经 setState 重渲染整棵宿主树。取证（3 节点项目画布、无头 Chromium 真实鼠标拖动、CDP Performance 指标）：拖拽期主线程脚本耗时每秒 0.876s → 0.369s（-58%）、任务耗时 0.954s → 0.446s（-53%）、帧率 46.9 → 59.6 fps。
- 连带修复：项目画布水合的 StrictMode 闩锁 bug——`useCanvasHydration` 的 `loadedRef` 闩锁让 StrictMode 第二轮 effect 直接退场，而第一轮的写入已被清理作废 ⇒ dev 下项目画布永久卡「加载中」。改为可重放（水合是幂等读，重放只多两次 dev-only 请求），两轮里必有一轮活守卫把结果提交进界面。
