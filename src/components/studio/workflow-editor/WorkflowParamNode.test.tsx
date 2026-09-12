// @vitest-environment jsdom
/* 画布上的对外参数卡片（视图层）—— ISSUE #355
 *
 * 卡片是画布上「参数 → 端口」连线的起点：端点必须真的点得动（ISSUE #355：
 * 「点击端点拉线会出现禁用标记」），「恢复默认」只在当前模式下确实连过线时可用。 */

import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useStoreApi,
} from "@xyflow/react";

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

/** 连线手势的成败写在 React Flow store 的 `connection` 上，DOM 里看不出来
 *  （jsdom 没有布局，连接线容器量不出宽高）—— 渲染时把 store 顺手捞出来。 */
type FlowStore = ReturnType<typeof useStoreApi>;

function StoreProbe({ onReady }: { onReady: (store: FlowStore) => void }) {
  const store = useStoreApi();
  useEffect(() => {
    onReady(store);
  }, [store, onReady]);
  return null;
}

/** 用真实的 mousedown + mousemove 走一遍连线手势。
 *
 *  jsdom 没有布局：React Flow 量不出容器矩形与端点位置（真实浏览器里由测量写），
 *  这里补上，否则手势在第一段就被拒。三段的顺序即 React Flow 的受理链：
 *
 *    ① 端点 class 含 `connectablestart`（= 宿主节点 connectable）
 *    ② mousedown 左键（@xyflow/react 的 <Handle> 绑的正是 `onMouseDown`）
 *    ③ 指针越过 connectionDragThreshold（默认 1px）才真正开画
 */
function startWireGesture(api: () => FlowStore, handle: HTMLElement): void {
  /* React Flow 用 elementFromPoint 判断「指针底下是不是另一颗端点」，jsdom 没实现。
   * 返回 null = 底下没有别的端点，走 closest-handle 那条路（本用例想要的就是这条）。 */
  document.elementFromPoint = () => null;
  const rect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 500,
    bottom: 500,
    width: 500,
    height: 500,
    toJSON: () => ({}),
  } as DOMRect;
  /* 必须打在**实例**上：容器元素由 React Flow 自己创建并持有，jsdom 里它量出来的
   *  矩形是全 0（真实浏览器有布局）。 */
  Object.defineProperty(api().getState().domNode!, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(handle, "getRootNode", {
    configurable: true,
    value: () => document,
  });
  const node = api().getState().nodeLookup.get("pio:5|size-width");
  if (node) {
    node.internals.handleBounds = {
      source: [
        {
          id: "5::widget::width",
          type: "source",
          position: Position.Right,
          x: 200,
          y: 40,
          width: 12,
          height: 12,
          nodeId: "pio:5|size-width",
        },
      ],
      target: [],
    };
  }

  handle.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: 40, clientY: 40 }),
  );
}

function renderNode(
  data: Partial<WorkflowParamNodeData> = {},
  /** 无自带手势授权的端点渲染器（模拟「只靠宿主节点 connectable」的旧行为）。 */
  legacyEndpoint = false,
) {
  let api: FlowStore | null = null;
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
    wireManual: false,
    wired: true,
    canReset: false,
    onReset: vi.fn(),
    outputPorts: [port("5::widget::width", "width", "INT", true, true)],
    ...data,
  };
  const view = render(
    <ReactFlowProvider>
      <StoreProbe onReady={(store) => (api = store)} />
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
        nodeTypes={{
          wfParam: legacyEndpoint
            ? ({ data: nodeData }: { data: WorkflowParamNodeData }) => (
                /* 旧行为：端点只有 `isConnectable`，手势授权全靠宿主节点
                 *  connectable（卡片节点上被写死 false → 点不动）。见下方回归用例。 */
                <WorkflowParamCard
                  entryId={nodeData.entryId}
                  cls={nodeData.cls}
                  label={nodeData.label}
                  classLabel={nodeData.classLabel}
                  hostNodeId={nodeData.hostNodeId}
                  inputRows={nodeData.inputRows}
                  width={nodeData.width}
                  canWire={nodeData.canWire}
                  wired={nodeData.wired}
                  canReset={nodeData.canReset}
                  outputPorts={nodeData.outputPorts}
                  endpoint={() => (
                    <Handle
                      id={nodeData.outputPorts[0]!.ioKey}
                      type="source"
                      position={Position.Right}
                      isConnectable
                      isConnectableStart={false}
                      isConnectableEnd={false}
                    />
                  )}
                />
              )
            : WorkflowParamNode,
        }}
        fitView={false}
      />
    </ReactFlowProvider>,
  );
  return { ...view, api: () => api! };
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

  it("端点可拉线：isConnectableStart / isConnectableEnd 都挂上", () => {
    /* 「对外参数卡片连不了线，点击端点拉线会出现禁用标记」（ISSUE #355）：
     *  React Flow 的 <Handle> 把「这一端能不能拉线 / 能不能落线」算作
     *  `handle.connectable && handle.connectableend`，其中 connectable 来自**宿主
     *  节点**（`node.connectable || nodesConnectable`）—— 卡片节点上写
     *  `connectable: false` 时每颗圆点都是点不动的装饰，hover 还会吃到「禁用」标记。
     *  这里显式把两段手势都授权给卡片自己，节点属性将来若被改回 false 也仍然连得上。 */
    const { container } = renderNode({ canWire: true });
    const handle = container.querySelector<HTMLElement>(".react-flow__handle")!;
    expect(handle.classList.contains("connectable")).toBe(true);
    expect(handle.classList.contains("connectablestart")).toBe(true);
    expect(handle.classList.contains("connectableend")).toBe(true);
  });

  it("页脚说清这个口现在连上了没有，以及怎么改", () => {
    /* 一颗空圆点读不出「默认线 / 你改过的线 / 一个候选都落不上」三态。 */
    const { unmount } = renderNode({ wired: true, wireManual: false });
    expect(
      screen.getByTestId("param-node-hint-5|size-width").textContent,
    ).toContain("默认连线");
    unmount();

    const manual = renderNode({ wired: true, wireManual: true });
    expect(
      screen.getByTestId("param-node-hint-5|size-width").textContent,
    ).toContain("你改过的线");
    manual.unmount();

    /* 没有候选端口（这个口在工作流里无处可落）—— 与「有候选但还没连」分开说。 */
    const empty = renderNode({
      wired: false,
      outputPorts: [port("", "尺寸", "*", false, false)],
    });
    expect(
      screen.getByTestId("param-node-hint-5|size-width").textContent,
    ).toContain("没有可连的参数行");
    empty.unmount();

    /* 有候选、还没连 → 直接给出该做的动作。 */
    renderNode({ wired: false });
    expect(
      screen.getByTestId("param-node-hint-5|size-width").textContent,
    ).toContain("拖圆点到节点参数行");
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

describe("端点手势：按下即开始连线（不是「不可连」的装饰）", () => {
  /* ISSUE #355 的原话是「对外参数卡片连不了线，点击端点拉线会出现禁用标记」。
   * React Flow 的受理链是三段串起来的，任一为假手势都在画线之前死掉：
   *
   *   ① 端点 class 含 `connectablestart`（= handle 的 isConnectableStart，且
   *      handle.connectable = 宿主节点 connectable || nodesConnectable）；
   *   ② mousedown 左键（@xyflow/react 的 <Handle> 绑的正是 `onMouseDown`）；
   *   ③ 指针移过 connectionDragThreshold 后才真正开画（默认 1px）。
   *
   * 这里把三段都走一遍，断言 store 里出现 connection.fromHandle —— 画布上那条
   * 连接线正是从它画出来的。写不进去 = 用户看到的就是「点不动 / 禁用标记」。
   * 手势的固定动作收在 startWireGesture 里，两条用例共用。 */
  it("在端点上按下并移动指针会进入连线态", () => {
    const { api, container } = renderNode({ canWire: true });
    const handle = container.querySelector<HTMLElement>(".react-flow__handle")!;
    expect(handle.getAttribute("data-handleid")).toBe("5::widget::width");
    /* 受理与否写在端点自带的 class 上（见 @xyflow/react 的 Handle 组件）。 */
    expect(handle.classList.contains("connectable")).toBe(true);
    expect(handle.classList.contains("connectablestart")).toBe(true);

    startWireGesture(api, handle);

    const from = api().getState().connection.fromHandle;
    expect(from?.nodeId).toBe("pio:5|size-width");
    expect(from?.id).toBe("5::widget::width");
  });

  it("端点自带的手势授权是必需的：只靠宿主节点 connectable 会被改回 false 拖死", () => {
    /* ISSUE #355 的原始故障：`connectable` 取自宿主节点
     *  （`node.connectable || nodesConnectable`）。卡片节点上写 false 时 React Flow
     *  不给端点加 `connectablestart`（连线的起点授权），端点照样画在卡片上，但
     *  按下去什么都不发生，指针旁还吃禁用标记。
     *
     *  这里渲染「端点没有自带那两段授权」的同款卡片（= workflow-param-nodes 里
     *  曾经的 `connectable: false`），确认手势确实死在第一段。 */
    const { api, container } = renderNode({ canWire: true }, true);
    const handle = container.querySelector<HTMLElement>(".react-flow__handle")!;
    expect(handle.classList.contains("connectablestart")).toBe(false);

    startWireGesture(api, handle);
    expect(api().getState().connection.fromHandle).toBeNull();
  });
});
