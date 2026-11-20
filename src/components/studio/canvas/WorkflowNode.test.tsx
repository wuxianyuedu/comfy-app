import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithFlow } from "../../../../tests/helpers/react-flow";
import { FlowNode } from "./WorkflowNode";
import { TooltipProvider } from "~/components/ui/tooltip";
import type { ComfyGraphNode, WorkflowDetail, WorkflowNodeData } from "../workflow-types";
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

/* 详情只喂 `nodes` 的 id；其余必填列按画布消费方用不到的最小值补齐。 */
function makeDetail(nodes: Array<ComfyGraphNode>): WorkflowDetail {
  return {
    graph: {},
    groups: null,
    id: "wf-test",
    name: "wf-test",
    nodes,
    notes: null,
    paramMap: {},
    positions: null,
    rawNodes: null,
    taskType: "",
    workflowIO: {},
  };
}

function renderFlowNode(data: WorkflowNodeData, stores: WFStores = makeStores()): WFStores {
  renderWithFlow(
    /* `Hint` 的浮层要 `TooltipProvider`（应用里挂在根布局 `app/layout` 上）。 */
    <TooltipProvider delay={0}>
      <WFStoresProvider stores={stores}>
        <FlowNode data={data} />
      </WFStoresProvider>
    </TooltipProvider>,
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
  it("渲染标题、#id chip、TOP PINS 连接行与 widget 参数行", async () => {
    const user = userEvent.setup();
    renderFlowNode(nodeData({ rawInputs: RAW_INPUTS }));
    expect(screen.getByText("主采样器")).toBeInTheDocument(); // displayTitle（作者标题优先）
    expect(screen.getByText("#9")).toBeInTheDocument(); // NodeIdChip（始终是真实节点 id）
    // TOP PINS：连接输入行（KSampler 静态输出 LATENT 组成共享行）
    expect(document.querySelector('[data-pin-input="model"]')).not.toBeNull();
    expect(document.querySelector('[data-pin-output="LATENT"]')).not.toBeNull();
    // widget 参数行 + 值 cell（悬停出完整值，走 <Hint>）
    expect(document.querySelector('[data-input-key="seed"]')).not.toBeNull();
    const valueCell = screen.getByText("42");
    expect(valueCell).not.toHaveAttribute("title");
    // #4533：值 cell 是「widget 槽凹陷井」——深底 + 圆角，铺在标签列之后的整格
    //（flex: 1 1 0），文本左对齐；标签列固定占比，各行值槽共享同一起点 x。
    expect(valueCell.className).toContain("bg-canvas-deep");
    expect(valueCell.className).toContain("rounded-sm");
    expect(valueCell.className).toContain("text-left");
    /* happy-dom 会把 flex 简写规范化成带 px 的形态（"1 1 0" → "1 1 0px"）。 */
    expect(valueCell.style.flex).toBe("1 1 0px");
    await user.hover(valueCell);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain("42");
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
    expect(screen.getByText("42")).toBeInTheDocument();
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
    const last = [...handles].at(-1);
    expect(last).toBeInstanceOf(HTMLElement);
    if (!(last instanceof HTMLElement)) {
      throw new Error("输出端点未渲染成 HTML 元素");
    }
    expect(last.style.opacity).toBe("0.35");
    expect(last.style.width).toBe("4px");
  });
});

/* 右上角编号必须是**节点真实 id**，不跟着项目画布的「短序号」约定走 ——
 * 项目画布按画布节点列表顺序显示 #1/#2…，工作流编辑器画布不是那个语义范围：
 * 它在一次「改项目画布右上角 id」的改动里被一起换成了 `detail.nodes` 下标映射，
 * 于是编辑器里的 #24 和 JSON 查看器 / 执行日志 / ComfyUI 报错里的 1670 对不上
 * （ISSUE #394）。 */
describe("FlowNode 右上角编号", () => {
  it("detail.nodes 在场时仍显示真实节点 id，不映射成短序号", () => {
    const stores = makeStores();
    stores.viewer.setState({
      detail: makeDetail([
        { id: "1", class_type: "KSampler", title: "1" },
        { id: "9", class_type: "KSampler", title: "9" },
        { id: "30", class_type: "KSampler", title: "30" },
      ]),
    });
    renderWithFlow(
      <WFStoresProvider stores={stores}>
        <FlowNode data={nodeData({ nodeId: "30", rawInputs: RAW_INPUTS })} />
      </WFStoresProvider>,
    );
    expect(screen.getByText("#30")).toBeInTheDocument();
    expect(screen.queryByText("#3")).toBeNull();
  });
});

/* ── ISSUE #4548 ─────────────────────────────────────────────────────────────
 * 已连线的 widget 输入（convert to input + link）曾经被三处观感一起误伤：
 *  ① 折叠锚点只认「值为连线元组」的条目，widget 联动输入的值是字符串，
 *    折叠态下没有 Handle → 落在这类输入上的边被 React Flow 静默丢弃（连线消失）；
 *  ② widget 行照常渲染值井 / textarea（数值明明由连线传递）；
 *  ③ StringTextarea 在 hasSize 的 flex 链上没有下限，多行 STRING 堆叠时被压成一条缝。
 * 下面三组用例分别钉住修复后的行为。 */

const LINKED_WIDGET_INPUTS = [
  {
    name: "string",
    type: "STRING",
    isConnection: true,
    widget: { name: "string" },
    widgetValue: "",
  },
  {
    name: "find",
    type: "STRING",
    isConnection: false,
    widget: { name: "find" },
    widgetValue: "{input text}",
    multiline: true,
  },
  {
    name: "replace",
    type: "STRING",
    isConnection: true,
    widget: { name: "replace" },
    widgetValue: "",
  },
];

describe("折叠态的已连线 widget 输入保留锚点（#4548 连线消失）", () => {
  it("折叠时已连线的 widget 输入仍有同 id 的 Handle，未连线的不出锚点", () => {
    renderFlowNode(
      nodeData({
        rawInputs: LINKED_WIDGET_INPUTS,
        flags: { collapsed: true },
        /* 折叠态的输出锚点只给「已连线」的输出 —— 模拟 LATENT 被下游占用。 */
        connectedOutputs: new Set(["LATENT"]),
      }),
    );
    /* string / replace 是 widget 联动输入（值为字符串）——折叠锚点必须照样给出
     * Handle，否则 buildEdges 的 targetHandle 找不到落点，边被静默丢弃。 */
    expect(document.querySelector('[data-handleid="string"]')).not.toBeNull();
    expect(document.querySelector('[data-handleid="replace"]')).not.toBeNull();
    /* find 没有连线 —— 不需要锚点。 */
    expect(document.querySelector('[data-handleid="find"]')).toBeNull();
    /* 输出侧锚点不受影响（nodeData 的 classType 是 KSampler，静态输出 LATENT）。 */
    expect(document.querySelector('[data-handleid="out:LATENT"]')).not.toBeNull();
  });
});

describe("已连线 widget 行不再渲染取值控件（#4548）", () => {
  it("连线行只剩标签 + 端点；未连线行保留值井 / textarea", () => {
    renderFlowNode(nodeData({ rawInputs: LINKED_WIDGET_INPUTS }));
    const linkedRow = document.querySelector('[data-input-key="string"]');
    expect(linkedRow).not.toBeNull();
    /* 数值由连线传递：本地 widgets_values 是过期的默认值，不再显示。 */
    expect(linkedRow?.querySelector(".bg-canvas-deep")).toBeNull();
    expect(linkedRow?.querySelector("textarea")).toBeNull();
    const replaceRow = document.querySelector('[data-input-key="replace"]');
    expect(replaceRow?.querySelector(".bg-canvas-deep")).toBeNull();
    expect(replaceRow?.querySelector("textarea")).toBeNull();
    /* 端点仍要可见（边的落点）。 */
    expect(document.querySelector('[data-handleid="string"]')).not.toBeNull();

    /* 未连线的「查找」保留值井 + textarea（值是真实本地值）。 */
    const findRow = document.querySelector('[data-input-key="find"]');
    expect(findRow?.querySelector(".bg-canvas-deep")).not.toBeNull();
    expect(findRow?.querySelector("textarea")).not.toBeNull();
  });
});

describe("悬停四角括号（#4549）", () => {
  it("卡片渲染四个角括号装饰，显隐交给外壳 data-hovered（不进 React 状态）", () => {
    renderFlowNode(nodeData({ rawInputs: RAW_INPUTS }));
    const corners = document.querySelectorAll(".flow-node-corner");
    expect(corners.length).toBe(4);
    /* 装饰不抢交互、不进无障碍树。 */
    for (const c of corners) {
      expect(c.getAttribute("aria-hidden")).toBe("true");
    }
    /* 四角各一：类名齐全。 */
    for (const side of ["tl", "tr", "bl", "br"]) {
      expect(document.querySelector(`.flow-node-corner-${side}`)).not.toBeNull();
    }
  });

  it("括号外角随节点圆角走（#4578）：四角都以 --radius 派生圆角，不再直角切过圆角", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    for (const side of ["tl", "tr", "bl", "br"]) {
      const start = css.indexOf(`.flow-node-corner-${side} {`);
      expect(start, `找到 .flow-node-corner-${side} 的样式块`).toBeGreaterThan(-1);
      const body = css.slice(start, css.indexOf("}", start));
      /* 与节点卡片（rounded-lg = var(--radius)）同心：内缩 3px，半径即 --radius - 3px。
         设置页改圆角档时括号自动跟随，不会回到直角切圆角的旧形态。 */
      expect(body).toContain("calc(var(--radius) - 3px)");
    }
  });
});
