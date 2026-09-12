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

/** 造一条输出端口（每颗点自带 ioKey / handleId，见 ParamOutputPort）。 */
function port(
  ioKey: string,
  name: string,
  type: string,
  connected: boolean,
  active: boolean,
) {
  return { ioKey, name, type, connected, active, handleId: ioKey };
}

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
    inputRows: [
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
    outputPorts: [port("5::widget::width", "width", "INT", true, true)],
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
    /* 「width」既是端口行也是输出端口行 —— 两处都该有（输入引脚 + 带类型的出口）。 */
    expect(screen.getAllByText("width").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("恢复默认")).toBeTruthy();
  });

  it("端口行尾显示端口类型（落点由那条线表达，不重复标一遍）", () => {
    renderNode();
    /* INT 出现两处：端口行尾 + 输出端口类型徽标。 */
    expect(screen.getAllByText("INT").length).toBeGreaterThanOrEqual(2);
  });

  it("输出端口行「名称 + 类型」右对齐到端点（顺序与端口行相反）", () => {
    /* 端点圆点压在这一行右端（见 WorkflowParamCardColumn / WorkflowParamNode），
     * 所以这一行的内容整组贴右 —— 名字在左、类型徽标在最右，紧挨圆点。
     * 端口行则相反（名字在左、类型在行尾），两处不是同一套顺序，别照着改。 */
    const { container } = renderNode({
      entryId: "prompt",
      cls: "prompt",
      label: "提示词",
      outputPorts: [port("9::widget::text", "positive_prompt", "STRING", true, true)],
    });
    const row = screen.getByTestId("param-node-out-prompt-0");
    expect(row.className).toContain("justify-end");
    /* 末位是注入的端点槽位（画布上是 <Handle>，无文本）。 */
    const cells = [...row.children].map((child) => child.textContent);
    expect(cells.slice(0, 2)).toEqual(["positive_prompt", "STRING"]);
    /* 端点由消费方注入，压在同一行的右端（这里是画布上的 <Handle>）。 */
    expect(container.querySelector(".react-flow__handle")).toBeTruthy();
  });

  it("卡片带一个**有类型**的输出端口（提示词 → STRING）", () => {
    renderNode({
      entryId: "prompt",
      cls: "prompt",
      label: "提示词",
      outputPorts: [port("9::widget::text", "positive_prompt", "STRING", true, true)],
    });
    expect(screen.getByTestId("param-node-out-type-prompt-0").textContent).toBe("STRING");
    expect(screen.getByText("positive_prompt")).toBeTruthy();
  });

  it("输出端口的类型跟着落点走（同一个尺寸口落到 COMBO 就写 COMBO）", () => {
    const { unmount } = renderNode({
      entryId: "size",
      cls: "size",
      label: "尺寸",
      outputPorts: [
        port("5::widget::resolution_preset", "resolution_preset", "COMBO", true, true),
      ],
    });
    expect(screen.getByTestId("param-node-out-type-size-0").textContent).toBe("COMBO");
    unmount();
  });

  it("未连线时输出端口标 *，不谎报类型", () => {
    renderNode({
      entryId: "size",
      cls: "size",
      label: "尺寸",
      outputPorts: [port("", "尺寸", "*", false, false)],
    });
    expect(screen.getByTestId("param-node-out-type-size-0").textContent).toBe("*");
  });

  it("多输出端口逐条列出（候选都被标出来）", () => {
    renderNode({
      entryId: "size",
      cls: "size",
      label: "尺寸",
      outputPorts: [
        port("5::widget::width", "width", "INT", false, false),
        port("5::widget::height", "height", "INT", false, false),
      ],
    });
    expect(screen.getByTestId("param-node-out-type-size-0").textContent).toBe("INT");
    expect(screen.getByTestId("param-node-out-type-size-1").textContent).toBe("INT");
    expect(screen.getAllByText("width").length).toBeGreaterThan(0);
    expect(screen.getAllByText("height").length).toBeGreaterThan(0);
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
        inputRows={[]}
        width={208}
        canWire={false}
        readOnly
        noModeHint
        canReset={false}
        outputPorts={[port("", "尺寸", "*", false, false)]}
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
    const pins = [
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
    ];
    renderNode({
      entryId: "5|size",
      pins,
      inputRows: pins,
      outputPorts: [
        port("5::widget::width", "width", "INT", false, false),
        port("5::widget::height", "height", "INT", false, false),
      ],
    });
    expect(screen.getAllByText("width").length).toBeGreaterThan(0);
    expect(screen.getAllByText("height").length).toBeGreaterThan(0);
  });

  it("每个候选落点各有一颗端点 —— 尺寸不再只有一个出口（ISSUE #355 复审）", () => {
    const pins = [
      { ioKey: "5::widget::aspect_ratio", name: "aspect_ratio", type: "COMBO", defaultValue: "16:9" },
      { ioKey: "5::widget::megapixels", name: "megapixels", type: "FLOAT", defaultValue: 1 },
    ];
    const { container } = renderNode({
      entryId: "size",
      cls: "size",
      label: "尺寸",
      pins,
      inputRows: pins,
      outputPorts: [
        port("5::widget::aspect_ratio", "aspect_ratio", "COMBO", false, false),
        port("5::widget::megapixels", "megapixels", "FLOAT", false, false),
      ],
    });
    /* 两颗端点，且各自的 handle id 就是对应端口的 ioKey：拖哪颗连到哪个候选。 */
    const handles = [...container.querySelectorAll(".react-flow__handle")].map(
      (element) => element.getAttribute("data-handleid") ?? element.id,
    );
    expect(handles.length).toBe(2);
    expect(handles.join(" ")).toContain("5::widget::aspect_ratio");
    expect(handles.join(" ")).toContain("5::widget::megapixels");
  });

  it("输入端口行按传入的 inputRows 渲染（组合控件接管的端口不重复列）", () => {
    renderNode({
      entryId: "size",
      cls: "size",
      label: "尺寸",
      pins: [
        { ioKey: "5::widget::width", name: "width", type: "INT", defaultValue: 512 },
        { ioKey: "5::widget::height", name: "height", type: "INT", defaultValue: 512 },
      ],
      /* 高度被组合控件接管 → 卡片只列宽度这一行。 */
      inputRows: [
        { ioKey: "5::widget::width", name: "width", type: "INT", defaultValue: 512 },
      ],
      outputPorts: [port("5::widget::width", "width", "INT", true, true)],
    });
    expect(screen.getAllByText("width").length).toBeGreaterThan(0);
    expect(screen.queryByText("height")).toBeNull();
  });
});
