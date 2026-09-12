// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { WorkflowSubgraphNode } from "./WorkflowSubgraphNode";
import {
  WFStoresProvider,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  type WFStores,
} from "../workflow-editor/WorkflowStores";

afterEach(cleanup);

function makeStores(): WFStores {
  return {
    io: createIOEditStore("wf-test"),
    rgthree: createRgthreeGroupsStore({ workflowId: "wf-test", detail: null }),
    viewer: createNodeJsonViewerStore({
      detail: null,
      rawMetaById: {},
      positions: null,
      subgraphRawContext: null,
      subgraphStackLength: 0,
    }),
  };
}

function renderNode(ui: ReactNode, stores: WFStores = makeStores()) {
  return render(
    <ReactFlowProvider>
      <WFStoresProvider stores={stores}>{ui}</WFStoresProvider>
    </ReactFlowProvider>,
  );
}

const baseData = {
  nodeId: "10",
  title: "我的子图",
  uid: "abcd1234",
  inputs: [],
  outputs: [],
  widgetValues: [],
};

describe("WorkflowSubgraphNode", () => {
  it("渲染子图标题与 #id 徽标", () => {
    const { container } = renderNode(<WorkflowSubgraphNode data={baseData} />);
    expect(screen.getByText("我的子图")).toBeInTheDocument();
    expect(screen.getByText("#10")).toBeInTheDocument();
    expect(container.querySelector('[data-variant="subgraph"]')).toBeTruthy();
    expect(container).toMatchSnapshot();
  });

  it("选中态透传 selected 不影响标题渲染", () => {
    renderNode(<WorkflowSubgraphNode data={baseData} selected />);
    expect(screen.getByText("我的子图")).toBeInTheDocument();
  });
});

describe("WorkflowSubgraphNode — 封装节点暴露口的显示名（ISSUE #349）", () => {
  const wrapperData = {
    ...baseData,
    inputs: [
      {
        name: "value_1",
        type: "INT",
        isConnection: false,
        widget: { name: "value_1" },
        widgetValue: 12345,
        proxyField: { nodeId: "12", field: "seed", label: "随机种子" },
      },
      {
        name: "value_2",
        type: "INT",
        isConnection: false,
        widget: { name: "value_2" },
        widgetValue: 20,
        proxyField: { nodeId: "12", field: "steps" },
      },
    ],
  };

  it("优先显示内部真实字段的业务名，而不是本层别名 value_1", () => {
    const { container } = renderNode(<WorkflowSubgraphNode data={wrapperData} />);
    expect(screen.getByText("随机种子")).toBeInTheDocument();
    // 内部字段没有 label/localized 时退到字段名，而不是别名。
    expect(screen.getByText("steps")).toBeInTheDocument();
    expect(container.textContent).not.toContain("value_1");
    expect(container.textContent).not.toContain("value_2");
  });

  it("勾选时透传的业务名与行上显示的一致（IO 面板不再对不上）", () => {
    const stores = makeStores();
    stores.io.setState({ ioEditMode: true });
    renderNode(<WorkflowSubgraphNode data={wrapperData} />, stores);
    const boxes = screen.getAllByTitle(/暴露为工作流/);
    boxes[0]!.click();
    const entries = Object.values(stores.io.getState().workflowIO);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe("随机种子");
  });
  /* 同 WorkflowNode：输出端点是下游 `out:<name>` 边的锚点，IO 编辑模式下
   * 不能卸载，只能降级视觉（ISSUE #394）。 */
  it("IO 编辑模式下子图输出端点仍在，仅视觉降级", () => {
    const data = {
      ...baseData,
      outputs: [{ name: "IMAGE", type: "IMAGE", links: [1] }],
      connectedOutputs: new Set(["IMAGE"]),
    };
    const stores = makeStores();
    renderNode(<WorkflowSubgraphNode data={data} />, stores);
    expect(document.querySelector('[data-handleid="out:IMAGE"]')).not.toBeNull();
    stores.io.setState({ ioEditMode: true });
    renderNode(<WorkflowSubgraphNode data={data} />, stores);
    const handles = document.querySelectorAll('[data-handleid="out:IMAGE"]');
    expect(handles.length).toBeGreaterThan(0);
    const last = handles[handles.length - 1] as HTMLElement;
    expect(last.style.opacity).toBe("0.35");
    expect(last.style.width).toBe("4px");
  });
});