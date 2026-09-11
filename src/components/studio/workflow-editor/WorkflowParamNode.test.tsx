// @vitest-environment jsdom
/* 对外参数卡片（视图层）—— ISSUE #355
 *
 * 卡片是画布上「参数 → 端口」连线的起点：有模式才渲染端点（没有模式禁止连线），
 * 「恢复默认」只在当前模式下确实画过线时可用。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";

import type { WorkflowParamNodeData } from "./workflow-param-node-data";
import { WorkflowParamNode } from "./WorkflowParamNode";

/* React Flow 挂载时自行测量容器尺寸；jsdom 没有 ResizeObserver。 */
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
);

afterEach(cleanup);

function renderNode(data: Partial<WorkflowParamNodeData> = {}) {
  const full: WorkflowParamNodeData = {
    entryId: "5|size-width",
    hostNodeId: "5",
    hostNodeTitle: "分辨率选择器",
    cls: "size-width",
    label: "宽度",
    classLabel: "宽度",
    pins: [{ ioKey: "5::widget::width", name: "width", type: "INT", defaultValue: 512 }],
    width: 208,
    canWire: true,
    canReset: false,
    onReset: vi.fn(),
    ...data,
  };
  return render(
    <ReactFlowProvider>
      <ReactFlow
        nodes={[{ id: "pio:5|size-width", type: "wfParam", position: { x: 0, y: 0 }, data: full }]}
        edges={[]}
        nodeTypes={{ wfParam: WorkflowParamNode }}
        fitView={false}
      />
    </ReactFlowProvider>
  );
}

describe("WorkflowParamNode", () => {
  it("渲染对外参数名与端口行，并带「恢复默认」按钮", () => {
    renderNode();
    expect(screen.getByText("宽度")).toBeTruthy();
    expect(screen.getByText("width")).toBeTruthy();
    expect(screen.getByLabelText("恢复默认")).toBeTruthy();
  });

  it("没有模式时提示「先选模式才能连线」，且不渲染端点", () => {
    const { container } = renderNode({ canWire: false });
    expect(screen.getByText("先选模式才能连线")).toBeTruthy();
    expect(container.querySelector(".react-flow__handle")).toBeNull();
  });

  it("有模式时渲染输出端点", () => {
    const { container } = renderNode({ canWire: true });
    expect(container.querySelector(".react-flow__handle")).toBeTruthy();
  });

  it("未改过线时「恢复默认」禁用（点了没有变化）", () => {
    renderNode({ canReset: false });
    expect(screen.getByLabelText("恢复默认")).toBeDisabled();
  });

  it("改过线时「恢复默认」可点，并回调宿主", () => {
    const onReset = vi.fn();
    renderNode({ canReset: true, onReset });
    screen.getByLabelText("恢复默认").click();
    expect(onReset).toHaveBeenCalled();
  });
});
