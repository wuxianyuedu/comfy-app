// @vitest-environment jsdom
/* 画布上的对外参数卡片（视图层）—— ISSUE #355
 *
 * 卡片是画布上「参数 → 端口」连线的起点：有模式才渲染端点（没有模式禁止连线），
 * 「恢复默认」只在当前模式下确实连过线时可用。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";

import type { WorkflowParamNodeData } from "./workflow-param-node-data";
import { WorkflowParamCard } from "./WorkflowParamCard";
import { WorkflowParamNode } from "./WorkflowParamNode";

/* React Flow 挂载时自行测量容器尺寸；jsdom 没有 ResizeObserver。 */
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
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
    pins: [
      {
        ioKey: "5::widget::width",
        name: "width",
        type: "INT",
        defaultValue: 512,
      },
    ],
    width: 208,
    canWire: true,
    noModeHint: false,
    canReset: false,
    onReset: vi.fn(),
    ...data,
  };
  return render(
    <ReactFlowProvider>
      <ReactFlow
        nodes={[
          {
            id: "pio:5|size-width",
            type: "wfParam",
            position: { x: 0, y: 0 },
            data: full,
          },
        ]}
        edges={[]}
        nodeTypes={{ wfParam: WorkflowParamNode }}
        fitView={false}
      />
    </ReactFlowProvider>,
  );
}

describe("WorkflowParamNode", () => {
  it("渲染对外参数名与端口行，并带「恢复默认」按钮", () => {
    renderNode();
    expect(screen.getByText("宽度")).toBeTruthy();
    expect(screen.getByText("width")).toBeTruthy();
    expect(screen.getByLabelText("恢复默认")).toBeTruthy();
  });

  it("端口行尾显示端口类型（落点由那条线表达，不重复标一遍）", () => {
    renderNode();
    expect(screen.getByText("INT")).toBeTruthy();
  });

  it("没有模式时不渲染端点，并说明「该工作流未声明模式」", () => {
    const { container } = renderNode({ canWire: false, noModeHint: true });
    expect(screen.getByText("该工作流未声明模式，落点暂不可编辑")).toBeTruthy();
    expect(container.querySelector(".react-flow__handle")).toBeNull();
  });

  it("只读消费（库内卡片列）不写任何编辑提示", () => {
    /* 库内卡片是只读视图，走 WorkflowParamCard 本体（不是画布节点）：这里以前
     * 复用 canWire=false，于是渲染出「先选模式才能连线」——而节点上的模式 chip
     * 明明已经写着「单图生视频」（ISSUE #355 复审）。 */
    render(
      <WorkflowParamCard
        entryId="size"
        cls="size"
        label="尺寸"
        classLabel="尺寸"
        hostNodeId="5"
        pins={[]}
        width={208}
        canWire={false}
        readOnly
        noModeHint
        canReset={false}
      />,
    );
    expect(screen.queryByText("该工作流未声明模式，落点暂不可编辑")).toBeNull();
    expect(screen.queryByText("先选模式才能连线")).toBeNull();
  });

  it("有模式时渲染输出端点", () => {
    const { container } = renderNode({ canWire: true });
    expect(container.querySelector(".react-flow__handle")).toBeTruthy();
  });

  it("未连过线时「恢复默认」禁用（点了没有变化）", () => {
    renderNode({ canReset: false });
    expect(screen.getByLabelText("恢复默认")).toBeDisabled();
  });

  it("连过线时「恢复默认」可点，并回调宿主", () => {
    const onReset = vi.fn();
    renderNode({ canReset: true, onReset });
    screen.getByLabelText("恢复默认").click();
    expect(onReset).toHaveBeenCalled();
  });

  it("多端口条目逐行列出各端口（宽度 + 高度在同一张卡上）", () => {
    renderNode({
      entryId: "5|size",
      pins: [
        {
          ioKey: "5::widget::width",
          name: "width",
          type: "INT",
          defaultValue: 512,
        },
        {
          ioKey: "5::widget::height",
          name: "height",
          type: "INT",
          defaultValue: 768,
        },
      ],
    });
    expect(screen.getByText("width")).toBeTruthy();
    expect(screen.getByText("height")).toBeTruthy();
  });
});
