// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithFlow } from "../../../../tests/helpers/react-flow";
import { FlowNode } from "./WorkflowNode";
import type { WorkflowNodeData } from "../workflow-types";
import {
  WFStoresProvider,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  type WFStores,
} from "../workflow-editor/WorkflowStores";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

/* FlowNode 内的 NodeIdChip / IoCheckbox 经 useIOEditContext 读取
 * WFStoresProvider 下发的三个 zustand store（无 Provider 会抛错），
 * 因此与 SubgraphHeader.test.tsx 同款：真实 store 工厂 + Provider 包装。 */
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

function renderFlowNode(data: WorkflowNodeData, stores: WFStores = makeStores()): WFStores {
  renderWithFlow(
    <WFStoresProvider stores={stores}>
      <FlowNode data={data} />
    </WFStoresProvider>,
  );
  return stores;
}

/* workflow-types 的 WorkflowNodeData 形状。title 显式给出（friendlyNodeTitle
 * 中作者标题优先于静态 zh 映射，可稳定断言）。KSampler 在离线输出表里有
 * LATENT 输出 → TOP PINS 会有对应的输出列。 */
function nodeData(overrides: Partial<WorkflowNodeData> = {}): WorkflowNodeData {
  return {
    nodeId: "9",
    classType: "KSampler",
    title: "主采样器",
    inputs: {},
    assignedRole: null,
    inputSources: {},
    ...overrides,
  };
}

/* rawInputs 两类行：
 *  - model：纯连接（isConnection，无 widget）→ TOP PINS 连接行 + target Handle
 *  - seed：  widget 行（widget + widgetValue）→ 参数行，值 cell 显示 42 */
const RAW_INPUTS = [
  { name: "model", type: "MODEL", isConnection: true },
  {
    name: "seed",
    type: "INT",
    isConnection: false,
    widget: { name: "seed" },
    widgetValue: 42,
  },
];

describe("FlowNode（WorkflowNode 渲染冒烟）", () => {
  it("渲染标题、#id chip、TOP PINS 连接行与 widget 参数行", () => {
    renderFlowNode(nodeData({ rawInputs: RAW_INPUTS }));
    expect(screen.getByText("主采样器")).toBeInTheDocument(); // displayTitle（作者标题优先）
    expect(screen.getByText("#9")).toBeInTheDocument(); // NodeIdChip（detail 为空 → 完整 id）
    // TOP PINS：连接输入行（KSampler 静态输出 LATENT 组成共享行）
    expect(document.querySelector('[data-pin-input="model"]')).not.toBeNull();
    expect(document.querySelector('[data-pin-output="LATENT"]')).not.toBeNull();
    // widget 参数行 + 值 cell（title=String(v)）
    expect(document.querySelector('[data-input-key="seed"]')).not.toBeNull();
    expect(screen.getByTitle("42")).toBeInTheDocument();
  });

  it("点击折叠按钮隐藏主体行，aria-label 翻转为「展开节点」", async () => {
    renderFlowNode(nodeData({ rawInputs: RAW_INPUTS }));
    await userEvent.click(screen.getByRole("button", { name: "折叠节点" }));
    expect(screen.getByRole("button", { name: "展开节点" })).toBeInTheDocument();
    expect(screen.getByText("主采样器")).toBeInTheDocument(); // 标题栏保留
    expect(document.querySelector('[data-input-key="seed"]')).toBeNull(); // widget 区隐藏
    expect(document.querySelector('[data-pin-input="model"]')).toBeNull(); // TOP PINS 隐藏
  });

  it("flags.collapsed=true 时初始折叠，再点击恢复展开（用户切换接管状态）", async () => {
    renderFlowNode(nodeData({ rawInputs: RAW_INPUTS, flags: { collapsed: true } }));
    expect(screen.getByRole("button", { name: "展开节点" })).toBeInTheDocument();
    expect(document.querySelector('[data-input-key="seed"]')).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "展开节点" }));
    expect(screen.getByRole("button", { name: "折叠节点" })).toBeInTheDocument();
    expect(document.querySelector('[data-input-key="seed"]')).not.toBeNull();
    expect(screen.getByTitle("42")).toBeInTheDocument();
  });
  /* 输出端点在 IO 编辑模式下必须继续挂载 —— 它同时是下游 `out:<name>` 边的
   * 锚点。此前 IO 编辑模式整个不渲染它，React Flow 解析不到 handle 就丢掉整条
   * 边（error#008），画布上表现为「这个节点的输出没有连线」（ISSUE #394）。 */
  it("IO 编辑模式下输出端点仍在，仅视觉降级", () => {
    const stores = renderFlowNode(nodeData({ rawInputs: RAW_INPUTS }));
    expect(document.querySelector('[data-handleid="out:LATENT"]')).not.toBeNull();
    stores.io.setState({ ioEditMode: true });
    renderFlowNode(nodeData({ rawInputs: RAW_INPUTS }), stores);
    const handles = document.querySelectorAll('[data-handleid="out:LATENT"]');
    expect(handles.length).toBeGreaterThan(0);
    /* 降级 = 缩小 + 降透明度，而不是卸载。 */
    const last = handles[handles.length - 1] as HTMLElement;
    expect(last.style.opacity).toBe("0.35");
    expect(last.style.width).toBe("4px");
  });
});