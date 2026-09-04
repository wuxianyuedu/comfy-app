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
