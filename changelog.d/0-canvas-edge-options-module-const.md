## Changed

- **项目画布连线默认项提为模块常量并关闭常驻动画（性能）**：`src/components/studio/ProjectCanvas.tsx`
  原先把 `defaultEdgeOptions` 与 `proOptions` 作为内联对象字面量写在 `<ReactFlow>`
  上，每次渲染都重建 → ReactFlow 的 props 浅比较恒失效，把整棵画布子树拖进
  reconcile（规范 §2.11）；且 `defaultEdgeOptions.animated: true` 给**每一条边**
  永久开启 CSS dash 动画，130+ 边的图即便不做任何操作也在逐帧 paint（DevTools
  Paint flashing 可见满屏闪烁）。改为模块级 `DEFAULT_EDGE_OPTIONS` /
  `PRO_OPTIONS` 常量，并 `animated: false`，与工作流编辑器画布
  （`WorkflowEditorCanvas` 同为模块常量 + `animated:false`）口径统一。
  `type:"smoothstep"`、`stroke:"url(#canvas-edge-gradient)"`、`strokeWidth`
  等渲染形状维持不变，仅去动画与对象重建。
