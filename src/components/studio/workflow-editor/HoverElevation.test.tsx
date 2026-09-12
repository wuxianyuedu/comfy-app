// @vitest-environment jsdom
//
// 悬浮置顶（ISSUE #400）：鼠标指着的节点必须压住连线。
//
// 链路是「鼠标进入节点 → 节点根元素打上 data-hovered → CSS 抬 z-index」。
// 抬升幅度在 globals.css（`.react-flow__node[data-hovered="true"]`），
// 这里测「属性有没有正确打上」以及「打上之后是否真的赢了连线」两件事，
// 外加最要紧的性能约定 —— 悬浮状态是本节点自己的，鼠标进出不惊动画布其余部分。
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FlowNode } from "../canvas/WorkflowNode";
import { useHoverElevation } from "./HoverElevation";
import {
  WFStoresProvider,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  type WFStores,
} from "./WorkflowStores";
import type { WorkflowNodeData } from "../workflow-types";

/* 真画布要自己量尺寸，jsdom 没有 ResizeObserver（同 WorkflowParamNode.test）。 */
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

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

/** 裸渲染节点（无画布）—— 只关心属性与事件，不关心层级。 */
function renderFlowNode(data: WorkflowNodeData) {
  return render(
    <ReactFlowProvider>
      <WFStoresProvider stores={makeStores()}>
        <FlowNode data={data} />
      </WFStoresProvider>
    </ReactFlowProvider>,
  );
}

/** 取节点根元素：FlowNode 渲染出的最外层卡片。 */
function cardOf(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>("[data-node-id]");
  expect(card).not.toBeNull();
  return card!;
}

describe("悬浮置顶：节点根元素的 data-hovered", () => {
  it("初始不写 data-hovered（避免全局选择器误命中）", () => {
    const { container } = renderFlowNode(nodeData());
    expect(cardOf(container).hasAttribute("data-hovered")).toBe(false);
  });

  it("鼠标移入 → 标记悬浮；移出 → 撤销", () => {
    const { container } = renderFlowNode(nodeData());
    const card = cardOf(container);

    fireEvent.mouseEnter(card);
    expect(card.getAttribute("data-hovered")).toBe("true");

    fireEvent.mouseLeave(card);
    expect(card.hasAttribute("data-hovered")).toBe(false);
  });

  it("属性落在卡片本体上，只有一个元素被标记", () => {
    const { container } = renderFlowNode(nodeData());
    const card = cardOf(container);
    fireEvent.mouseEnter(card);

    /* React Flow 的 CSS 选择器是 `.react-flow__node[data-hovered="true"]` ——
     * 属性若挂到子元素上，选择器不会命中，「悬浮抬升」会静默失效。 */
    const marked = container.querySelectorAll('[data-hovered="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(card);
  });

  it("悬浮前后节点内容不变（不会因为抬层级丢端口 / 标题）", () => {
    const { container } = renderFlowNode(nodeData());
    const card = cardOf(container);
    act(() => {
      fireEvent.mouseEnter(card);
    });
    expect(screen.getByText("主采样器")).toBeTruthy();
    expect(card.getAttribute("data-node-id")).toBe("9");
  });
});

describe("悬浮压住连线：CSS 抬升规则", () => {
  /* jsdom 量不出 Handle 尺寸 → React Flow 不渲染任何连线，DOM 层面断言不了
   * 「节点 vs 线」的相对层级。改为直接盯住那条 CSS 契约：它是「悬浮压住连线」
   * 的全部实现，规则丢了 / 选择器写错了，画布上就会静默退回 ISSUE #400 的现状。 */
  const css = readFileSync(
    path.resolve(__dirname, "../../../app/globals.css"),
    "utf8",
  );

  it("globals.css 里有悬浮态抬升规则", () => {
    expect(css).toMatch(
      /\.react-flow__node\[data-hovered="true"\]\s*\{[^}]*z-index:\s*\d+\s*!important/,
    );
  });

  it("抬升值高于节点自带 zIndex，也高于选中态（+1000）", () => {
    const decl = /\.react-flow__node\[data-hovered="true"\]\s*\{[^}]*z-index:\s*(\d+)/.exec(
      css,
    );
    expect(decl).not.toBeNull();
    const hoverZ = Number(decl![1]);
    /* 节点自带 zIndex 最大 11（子图卡片）、选中态 ≈1010（elevateNodesOnSelect）。 */
    expect(hoverZ).toBeGreaterThan(1010);
    /* 低于节点内部浮层 / <Handle> 惯用的 9999 档，避免反过来盖住端口。 */
    expect(hoverZ).toBeLessThan(9999);
  });

  it("抬升只针对被标记的节点，不误伤其余节点与连线", () => {
    /* 选择器必须带 [data-hovered="true"] —— 无条件给 .react-flow__node 抬层级
     * 会让所有节点常驻最上层，等于把「连线压在节点上」的默认关系永久倒过来。 */
    const rule = css.includes('.react-flow__node[data-hovered="true"]');
    expect(rule).toBe(true);
    expect(/\.react-flow__node\s*\{[^}]*z-index:[^}]*!important/.test(css)).toBe(false);
  });

  it("注释里写明了 !important 的理由（行内 z-index 优先于类选择器）", () => {
    const idx = css.indexOf('.react-flow__node[data-hovered="true"]');
    expect(idx).toBeGreaterThan(-1);
    const before = css.slice(Math.max(0, idx - 1400), idx);
    expect(before).toContain("!important");
  });
});

describe("useHoverElevation", () => {
  /** 最小探针：把 hook 的状态渲染成可断言的属性。 */
  function Probe() {
    const { hovered, hoverHandlers } = useHoverElevation();
    return (
      <div
        data-testid="probe"
        data-hovered={hovered ? "true" : undefined}
        {...hoverHandlers}
      />
    );
  }

  it("初始为 false，事件来回翻转", () => {
    const { getByTestId } = render(<Probe />);
    const probe = getByTestId("probe");

    expect(probe.hasAttribute("data-hovered")).toBe(false);
    fireEvent.mouseEnter(probe);
    expect(probe.getAttribute("data-hovered")).toBe("true");
    fireEvent.mouseLeave(probe);
    expect(probe.hasAttribute("data-hovered")).toBe(false);
  });

  it("已在悬浮态时再次 mouseenter 不抖动（状态值没变）", () => {
    const { getByTestId } = render(<Probe />);
    const probe = getByTestId("probe");

    fireEvent.mouseEnter(probe);
    fireEvent.mouseEnter(probe);
    fireEvent.mouseEnter(probe);
    /* 仍是悬浮态：不会累积、不会来回抖。 */
    expect(probe.getAttribute("data-hovered")).toBe("true");

    fireEvent.mouseLeave(probe);
    expect(probe.hasAttribute("data-hovered")).toBe(false);
  });
});

describe("悬浮状态是每个节点自己的", () => {
  it("两个相邻节点各自独立悬浮，互不影响", () => {
    const { container } = render(
      <ReactFlowProvider>
        <WFStoresProvider stores={makeStores()}>
          <FlowNode data={nodeData({ nodeId: "9", title: "主采样器" })} />
          <FlowNode data={nodeData({ nodeId: "10", title: "第二采样器" })} />
        </WFStoresProvider>
      </ReactFlowProvider>,
    );
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>("[data-node-id]"),
    );
    expect(cards).toHaveLength(2);

    fireEvent.mouseEnter(cards[0]!);
    expect(cards[0]!.getAttribute("data-hovered")).toBe("true");
    expect(cards[1]!.hasAttribute("data-hovered")).toBe(false);

    fireEvent.mouseEnter(cards[1]!);
    fireEvent.mouseLeave(cards[0]!);
    expect(cards[1]!.getAttribute("data-hovered")).toBe("true");
    expect(cards[0]!.hasAttribute("data-hovered")).toBe(false);
  });

  it("反复进出不会留下悬挂的标记（无全局状态可累积）", () => {
    const { container } = renderFlowNode(nodeData());
    const card = cardOf(container);
    for (let round = 0; round < 5; round += 1) {
      fireEvent.mouseEnter(card);
      fireEvent.mouseLeave(card);
    }
    expect(container.querySelectorAll('[data-hovered="true"]')).toHaveLength(0);
  });
});
