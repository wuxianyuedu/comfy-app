/** ReactFlow Provider 测试包装 — 画布节点组件（CanvasNode / FlowNode / WorkflowSubgraphNode 等）脱离 <ReactFlow>
 * 独立渲染：`useReactFlow()` / `Handle` / `useStore()` 从 @xyflow/react 的 StoreContext 取值，无 Provider 抛 error001；
 * ReactFlowProvider 只建 store + context、不渲染视口，故不触发 jsdom 尺寸测量告警；外层 800×600 div 让测量拿到
 * 非零值避免 0×0 无限重测。用法 renderWithFlow(<CanvasNode/>)，返回值同 RTL render，rerender 也走 Provider 包装。
 */
import React from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";

type FlowRenderOptions = Omit<RenderOptions, "wrapper">;

export function renderWithFlow(
  ui: React.ReactElement,
  options: FlowRenderOptions = {},
): RenderResult {
  /* RTL 的 wrapper 选项在 rerender 时也会复用同一个包装组件，
   * 因此 Provider store 在整个用例生命周期内保持稳定。 */
  return render(ui, { wrapper: FlowWrapper, ...options });
}

function FlowWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 800, height: 600, position: "relative" }}>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </div>
  );
}
