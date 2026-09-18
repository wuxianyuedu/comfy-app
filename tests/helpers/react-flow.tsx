/**
 * ReactFlow Provider 测试包装 — 供画布节点组件（CanvasNode / FlowNode /
 * WorkflowSubgraphNode 等）在脱离 <ReactFlow> 画布时独立渲染。
 *
 * 为什么需要 Provider：
 *   - `useReactFlow()` / `Handle` / `useStore()`（如 NodeFrost.FrostLayer）
 *     都从 @xyflow/react 的 StoreContext 取值；没有 Provider 时会抛
 *     error001（"React Flow hooks must be used within <ReactFlowProvider>"）。
 *   - ReactFlowProvider 本身只创建 store + context，不渲染视口，
 *     因此不会触发 jsdom 下 <ReactFlow> 的尺寸测量（ResizeObserver /
 *     MeasureScroll 循环告警）。
 *
 * 固定尺寸容器：
 *   外层包一个 800×600 的 div，让任何基于 offsetParent / clientWidth 的
 *   内部测量拿到稳定的非零值，避免 jsdom（默认 0×0）下的无限重测告警。
 *
 * 用法：
 *   用法示例：renderWithFlow(<CanvasNode {...props} />)
 *   返回值与 RTL render 完全一致（container / rerender / unmount / queries）。
 *   rerender 时同样走 Provider 包装。
 */
import React from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";

type FlowRenderOptions = Omit<RenderOptions, "wrapper">;

export function renderWithFlow(ui: React.ReactElement, options: FlowRenderOptions = {}): RenderResult {
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
