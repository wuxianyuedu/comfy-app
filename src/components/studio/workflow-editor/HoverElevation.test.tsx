//
// 悬浮置顶（ISSUE #400）：鼠标指着的节点必须压住连线。
//
// 链路是「鼠标进入节点 → **React Flow 的节点外壳**打上 data-hovered → CSS 抬
// z-index」。抬升幅度在 globals.css（`.react-flow__node[data-hovered="true"]`）。
//
// 这里盯住三件事：
//   1. 属性落在 `.react-flow__node` 外壳上 —— 外壳带 position:absolute + 行内
//      z-index，自成层叠上下文；属性若落在卡片本体上，CSS 选择器永远不命中，
//      「悬浮抬升」会静默失效（这正是本 ISSUE 修复前的实际故障）。
//   2. 移开后属性撤销，不与其他节点串味。
//   3. 悬浮状态是本节点自己的 —— 鼠标进出不惊动画布其余部分。
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FlowNode } from "../canvas/WorkflowNode";
import { HOVER_ATTRIBUTE, useHoverElevation } from "./HoverElevation";
import {
  WFStoresProvider,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  type WFStores,
} from "./WorkflowStores";
import type { WorkflowNodeData } from "../workflow-types";

/* 真画布要自己量尺寸，jsdom 没有 ResizeObserver。 */
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

/** React Flow 的节点外壳：真实画布上由库渲染，本站测试里手搭同构的 DOM。
 *
 *  外壳带 `position:absolute` + 行内 `z-index` —— 这是「属性必须落在外壳上」
 *  的原因，也是 CSS 选择器 `.react-flow__node[data-hovered="true"]` 的落点。 */
function renderInsideNodeWrapper(data: WorkflowNodeData) {
  return render(
    <div
      className="react-flow__node react-flow__node-wfNode"
      style={{ position: "absolute", zIndex: 10 }}
    >
      <ReactFlowProvider>
        <WFStoresProvider stores={makeStores()}>
          <FlowNode data={data} />
        </WFStoresProvider>
      </ReactFlowProvider>
    </div>,
  );
}

/** 卡片本体（节点组件渲染的最外层元素）。 */
function cardOf(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>("[data-node-id]");
  expect(card).not.toBeNull();
  return card!;
}

/** React Flow 外壳。 */
function wrapperOf(container: HTMLElement): HTMLElement {
  const wrapper = container.querySelector<HTMLElement>(".react-flow__node");
  expect(wrapper).not.toBeNull();
  return wrapper!;
}

describe("悬浮置顶：标记落在 React Flow 的节点外壳上", () => {
  it("初始不写 data-hovered（避免全局选择器误命中）", () => {
    const { container } = renderInsideNodeWrapper(nodeData());
    expect(wrapperOf(container).hasAttribute(HOVER_ATTRIBUTE)).toBe(false);
    expect(
      container.querySelectorAll(`[${HOVER_ATTRIBUTE}="true"]`),
    ).toHaveLength(0);
  });

  it("鼠标移入卡片 → 外壳打标记；移出 → 撤销", () => {
    const { container } = renderInsideNodeWrapper(nodeData());
    const card = cardOf(container);
    const wrapper = wrapperOf(container);

    fireEvent.mouseEnter(card);
    expect(wrapper.getAttribute(HOVER_ATTRIBUTE)).toBe("true");

    fireEvent.mouseLeave(card);
    expect(wrapper.hasAttribute(HOVER_ATTRIBUTE)).toBe(false);
  });

  it("标记只落在外壳上，不落在卡片本体（否则 CSS 选择器不命中）", () => {
    /* 回归护栏：这正是 ISSUE #400 修复前的实际故障 —— 属性写在卡片本体上，
     *  `.react-flow__node[data-hovered="true"]` 永远不匹配，悬浮抬升静默失效。
     *  卡片本体自带 position:static 且在外壳的层叠上下文内，抬它抬不出外壳。 */
    const { container } = renderInsideNodeWrapper(nodeData());
    const card = cardOf(container);
    const wrapper = wrapperOf(container);
    fireEvent.mouseEnter(card);

    expect(wrapper.getAttribute(HOVER_ATTRIBUTE)).toBe("true");
    expect(card.hasAttribute(HOVER_ATTRIBUTE)).toBe(false);
  });

  it("被标记的元素确实能被 CSS 选择器命中", () => {
    const { container } = renderInsideNodeWrapper(nodeData());
    const card = cardOf(container);
    fireEvent.mouseEnter(card);

    const marked = container.querySelector(
      `.react-flow__node[${HOVER_ATTRIBUTE}="true"]`,
    );
    expect(marked).not.toBeNull();
    expect(marked).toBe(wrapperOf(container));
  });

  it("悬浮前后节点内容不变（不会因为抬层级丢端口 / 标题）", () => {
    const { container } = renderInsideNodeWrapper(nodeData());
    const card = cardOf(container);
    fireEvent.mouseEnter(card);
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
    const decl =
      /\.react-flow__node\[data-hovered="true"\]\s*\{[^}]*z-index:\s*(\d+)/.exec(
        css,
      );
    expect(decl).not.toBeNull();
    const hoverZ = Number(decl![1]);
    /* 节点自带 zIndex 最大 20（对外参数卡片）、选中态 ≈1010（elevateNodesOnSelect）。 */
    expect(hoverZ).toBeGreaterThan(1010);
    /* 低于节点内部浮层 / <Handle> 惯用的 9999 档，避免反过来盖住端口。 */
    expect(hoverZ).toBeLessThan(9999);
  });

  it("抬升只针对被标记的节点，不误伤其余节点与连线", () => {
    /* 选择器必须带 [data-hovered="true"] —— 无条件给 .react-flow__node 抬层级
     * 会让所有节点常驻最上层，等于把「连线压在节点上」的默认关系永久倒过来。 */
    expect(css.includes('.react-flow__node[data-hovered="true"]')).toBe(true);
    expect(
      /\.react-flow__node\s*\{[^}]*z-index:[^}]*!important/.test(css),
    ).toBe(false);
  });

  it("注释里写明了 !important 的理由（行内 z-index 优先于类选择器）", () => {
    const idx = css.indexOf('.react-flow__node[data-hovered="true"]');
    expect(idx).toBeGreaterThan(-1);
    const before = css.slice(Math.max(0, idx - 1400), idx);
    expect(before).toContain("!important");
  });
});

describe("useHoverElevation", () => {
  /** 最小探针：把钩子的状态渲染到「卡片 → 外壳」两层结构上，断言外壳被标记。 */
  function Probe() {
    const { hoverHandlers, hoverRef } = useHoverElevation();
    return (
      <div className="react-flow__node" data-testid="wrapper">
        <div data-testid="probe" ref={hoverRef} {...hoverHandlers} />
      </div>
    );
  }

  it("初始不标记，进出翻转", () => {
    const { getByTestId } = render(<Probe />);
    const probe = getByTestId("probe");
    const wrapper = getByTestId("wrapper");

    expect(wrapper.hasAttribute(HOVER_ATTRIBUTE)).toBe(false);
    fireEvent.mouseEnter(probe);
    expect(wrapper.getAttribute(HOVER_ATTRIBUTE)).toBe("true");
    fireEvent.mouseLeave(probe);
    expect(wrapper.hasAttribute(HOVER_ATTRIBUTE)).toBe(false);
  });

  it("已在悬浮态时再次 mouseenter 不抖动", () => {
    const { getByTestId } = render(<Probe />);
    const probe = getByTestId("probe");
    const wrapper = getByTestId("wrapper");

    fireEvent.mouseEnter(probe);
    fireEvent.mouseEnter(probe);
    fireEvent.mouseEnter(probe);
    expect(wrapper.getAttribute(HOVER_ATTRIBUTE)).toBe("true");

    fireEvent.mouseLeave(probe);
    expect(wrapper.hasAttribute(HOVER_ATTRIBUTE)).toBe(false);
  });

  it("没有外壳时静默降级（不抛错、不留悬挂标记）", () => {
    function Bare() {
      const { hoverHandlers, hoverRef } = useHoverElevation();
      return <div data-testid="bare" ref={hoverRef} {...hoverHandlers} />;
    }
    const { getByTestId } = render(<Bare />);
    const bare = getByTestId("bare");
    expect(() => fireEvent.mouseEnter(bare)).not.toThrow();
    expect(
      document.querySelectorAll(`[${HOVER_ATTRIBUTE}="true"]`),
    ).toHaveLength(0);
  });
});

describe("悬浮状态是每个节点自己的", () => {
  it("两个相邻节点各自独立悬浮，互不影响", () => {
    const { container } = render(
      <div className="react-flow__node" data-node-wrapper="9">
        <ReactFlowProvider>
          <WFStoresProvider stores={makeStores()}>
            <FlowNode data={nodeData({ nodeId: "9", title: "主采样器" })} />
          </WFStoresProvider>
        </ReactFlowProvider>
      </div>,
    );
    const { container: second } = render(
      <div className="react-flow__node" data-node-wrapper="10">
        <ReactFlowProvider>
          <WFStoresProvider stores={makeStores()}>
            <FlowNode data={nodeData({ nodeId: "10", title: "第二采样器" })} />
          </WFStoresProvider>
        </ReactFlowProvider>
      </div>,
    );

    const cardA = cardOf(container);
    const wrapperA = wrapperOf(container);
    const wrapperB = wrapperOf(second);

    fireEvent.mouseEnter(cardA);
    expect(wrapperA.getAttribute(HOVER_ATTRIBUTE)).toBe("true");
    expect(wrapperB.hasAttribute(HOVER_ATTRIBUTE)).toBe(false);
  });

  it("反复进出不会留下悬挂的标记", () => {
    const { container } = renderInsideNodeWrapper(nodeData());
    const card = cardOf(container);
    for (let round = 0; round < 5; round += 1) {
      fireEvent.mouseEnter(card);
      fireEvent.mouseLeave(card);
    }
    expect(
      container.querySelectorAll(`[${HOVER_ATTRIBUTE}="true"]`),
    ).toHaveLength(0);
  });
});
