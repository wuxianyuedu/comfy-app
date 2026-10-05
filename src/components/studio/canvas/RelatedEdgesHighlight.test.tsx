// 选中节点 → 相关连线高亮：接线层集成测试。
//
// 纯判据已由 flow-focus-endpoints.test.ts 覆盖；这里验的是「读 React Flow 内部
// 选中事实源 → 写回 edges」这条接线本身，它是本功能唯一真正的风险点：
//   1. 选中事实源取的是 `nodeLookup[*].internals.userNode.selected`（而不是业务侧
//      nodes 数组）—— 取错了就永远算不出选中项，功能静默失效；
//   2. 相关连线带关注级别，无关连线只带「画布有选中项」开关（渲染层据此压暗）；
//   3. 取消选中时两样标记都必须清干净。这条是实测发现的真 bug：`focusActive`
//      残留曾让取消选中后全图仍然发灰。

import { useCallback, useEffect, useRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useStoreApi,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  EDGE_FOCUS_ACTIVE_KEY,
  EDGE_FOCUS_DATA_KEY,
  NODE_PORT_FOCUS_ACTIVE_KEY,
  NODE_PORT_FOCUS_DATA_KEY,
  readEdgeFocusRole,
  readPortFocusRole,
  useRelatedEdgesHighlight,
} from "./hooks/use-related-edges-highlight";

/* jsdom 不含 ResizeObserver，而 <ReactFlow> 挂载期就会用它测量视口。
 * 桩成「只记录、从不回调」：本用例断言的是边表状态，不依赖任何真实尺寸。 */
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        /* 不触发：本用例不需要尺寸回调 */
      }
      unobserve() {
        /* 同上 */
      }
      disconnect() {
        /* 同上 */
      }
    },
  );
});

afterEach(cleanup);

const asNodes = (ids: readonly string[]): Node[] =>
  ids.map((id, index) => ({
    id,
    position: { x: index * 200, y: 0 },
    data: {},
  }));

/** 1 → 2 → 3：选中 2 时，e-1-2 是上游、e-2-3 是下游。 */
const EDGES: Edge[] = [
  { id: "e-1-2", source: "1", target: "2" },
  { id: "e-2-3", source: "2", target: "3" },
];

/** 折叠锚点场景：连线挂在锚点 id 上，节点本体用业务 id 渲染。 */
const ANCHOR_EDGES: Edge[] = [
  { id: "e-anchor-in", source: "anchor:1", target: "anchor:2" },
  { id: "e-anchor-out", source: "anchor:2", target: "anchor:3" },
];

/** 观测棚：hook 跑在画布内，测试侧通过它取边表 / 触发选中。
 *  用对象字面量持有可变字段（而不是改 hook 参数），避免踩 React 19 的
 *  immutability 规则；写入放在 usePublish 的 effect 里，不在渲染期。 */
interface Sink {
  edges: Edge[];
  /** 最新节点表（带端口关注标记的那一份）。 */
  nodes: Node[];
  select: (nodeId: string, selected: boolean) => void;
  /** 删掉一条连线（模拟作者断开映射 / 上游节点被删）。 */
  dropEdge: (edgeId: string) => void;
}

function Stage({
  sink,
  nodeIds,
  edges,
  resolveNodeId,
}: {
  sink: Sink;
  nodeIds: readonly string[];
  edges: Edge[];
  resolveNodeId?: (visualNodeId: string) => string | null;
}) {
  const [nodes, setNodes] = useNodesState(asNodes(nodeIds));
  const [currentEdges, setEdges, onEdgesChange] = useEdgesState(edges);
  const store = useStoreApi();
  /* useEdgesState / useNodesState 的 setter 本身稳定，包一层是为了满足 hook
   * 依赖写法（且让「未传 setNodes」的老调用方行为不变）。 */
  const applyEdges = useCallback(
    (updater: (current: Edge[]) => Edge[]) => {
      setEdges(updater);
    },
    [setEdges],
  );
  const applyNodes = useCallback(
    (updater: (current: Node[]) => Node[]) => {
      setNodes(updater);
    },
    [setNodes],
  );
  useRelatedEdgesHighlight(applyEdges, { resolveNodeId, setNodes: applyNodes });

  const select = useCallback(
    (nodeId: string, selected: boolean) => {
      const internal = store.getState().nodeLookup.get(nodeId);
      if (!internal) return;
      internal.internals.userNode.selected = selected;
      store.setState({});
    },
    [store],
  );

  /* 每次提交后把最新边表与选中入口同步到观测棚。写的是 ref（不是 props / hook
   * 参数），且只在 effect 里写一次 —— React 19 的 refs / immutability 两条规则
   * 都拦渲染期或跨提交改外部值。 */
  const dropEdge = useCallback(
    (edgeId: string) => {
      setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    },
    [setEdges],
  );

  const sinkRef = useRef(sink);
  useEffect(() => {
    sinkRef.current.edges = currentEdges;
    sinkRef.current.nodes = nodes;
    sinkRef.current.select = select;
    sinkRef.current.dropEdge = dropEdge;
  });

  return (
    <div style={{ width: 800, height: 600, position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={currentEdges}
        onEdgesChange={onEdgesChange}
        fitView={false}
      >
        <div data-testid="canvas-ready" />
      </ReactFlow>
    </div>
  );
}

function renderStage(
  options: {
    nodeIds?: readonly string[];
    edges?: Edge[];
    resolveNodeId?: (visualNodeId: string) => string | null;
  } = {},
): Sink {
  const sink: Sink = {
    edges: [],
    nodes: [],
    select: () => undefined,
    dropEdge: () => undefined,
  };
  render(
    <ReactFlowProvider>
      <Stage
        sink={sink}
        nodeIds={options.nodeIds ?? ["1", "2", "3"]}
        edges={options.edges ?? EDGES}
        resolveNodeId={options.resolveNodeId}
      />
    </ReactFlowProvider>,
  );
  expect(screen.getByTestId("canvas-ready")).toBeTruthy();
  return sink;
}

function toggleSelected(sink: Sink, nodeId: string, selected: boolean) {
  act(() => {
    sink.select(nodeId, selected);
  });
}

function edgeById(sink: Sink, id: string): Edge {
  const edge = sink.edges.find((candidate) => candidate.id === id);
  expect(edge).toBeTruthy();
  return edge!;
}

function nodeById(sink: Sink, id: string): Node {
  const node = sink.nodes.find((candidate) => candidate.id === id);
  expect(node).toBeTruthy();
  return node!;
}

describe("readEdgeFocusRole", () => {
  it("未标记 / 非法值都归零，只认三种关注级别", () => {
    expect(readEdgeFocusRole({ data: undefined })).toBe("none");
    expect(readEdgeFocusRole({ data: {} })).toBe("none");
    expect(
      readEdgeFocusRole({ data: { [EDGE_FOCUS_DATA_KEY]: "nonsense" } }),
    ).toBe("none");
    expect(
      readEdgeFocusRole({ data: { [EDGE_FOCUS_DATA_KEY]: "upstream" } }),
    ).toBe("upstream");
    expect(
      readEdgeFocusRole({ data: { [EDGE_FOCUS_DATA_KEY]: "downstream" } }),
    ).toBe("downstream");
    expect(
      readEdgeFocusRole({ data: { [EDGE_FOCUS_DATA_KEY]: "related" } }),
    ).toBe("related");
  });
});

describe("useRelatedEdgesHighlight 写回端口行级别", () => {
  it("选中中间节点：落到它上面的端口行按上游 / 下游标记", () => {
    const sink = renderStage({
      edges: [
        { id: "e-1-2", source: "1", target: "2", targetHandle: "seed" },
        { id: "e-2-3", source: "2", target: "3", sourceHandle: "IMAGE" },
      ],
    });
    toggleSelected(sink, "2", true);
    const data = nodeById(sink, "2").data;
    expect(readPortFocusRole(data, "seed")).toBe("upstream");
    expect(readPortFocusRole(data, "out:IMAGE")).toBe("downstream");
    expect(data[NODE_PORT_FOCUS_ACTIVE_KEY]).toBe(true);
  });

  it("无关节点只带「有选中项」开关，不写任何端口标记", () => {
    const sink = renderStage();
    toggleSelected(sink, "2", true);
    const data = nodeById(sink, "1").data;
    expect(data[NODE_PORT_FOCUS_DATA_KEY]).toBeUndefined();
    expect(data[NODE_PORT_FOCUS_ACTIVE_KEY]).toBe(true);
  });

  it("取消选中：端口标记与开关一起清干净（不留「全图仍发灰」的残留）", () => {
    const sink = renderStage({
      edges: [{ id: "e-1-2", source: "1", target: "2", targetHandle: "seed" }],
    });
    toggleSelected(sink, "2", true);
    expect(readPortFocusRole(nodeById(sink, "2").data, "seed")).toBe(
      "upstream",
    );

    toggleSelected(sink, "2", false);
    for (const node of sink.nodes) {
      const data = node.data;
      expect(data?.[NODE_PORT_FOCUS_DATA_KEY]).toBeUndefined();
      expect(data?.[NODE_PORT_FOCUS_ACTIVE_KEY]).toBeUndefined();
    }
  });

  it("连线增删会重算端口行：断开后那一行不再亮", () => {
    const sink = renderStage({
      edges: [{ id: "e-1-2", source: "1", target: "2", targetHandle: "seed" }],
    });
    toggleSelected(sink, "2", true);
    expect(readPortFocusRole(nodeById(sink, "2").data, "seed")).toBe(
      "upstream",
    );

    act(() => {
      sink.dropEdge("e-1-2");
    });
    expect(readPortFocusRole(nodeById(sink, "2").data, "seed")).toBe("none");
  });
});

describe("useRelatedEdgesHighlight", () => {
  it("未选中任何节点：边表保持原样，不写任何标记", () => {
    const sink = renderStage();
    for (const edge of sink.edges) {
      expect(edge.data).toBeUndefined();
    }
  });

  it("选中中间节点：上游、下游分别标记，且都带「有选中项」开关", () => {
    const sink = renderStage();
    toggleSelected(sink, "2", true);

    const upstream = edgeById(sink, "e-1-2");
    const downstream = edgeById(sink, "e-2-3");
    expect(readEdgeFocusRole(upstream)).toBe("upstream");
    expect(readEdgeFocusRole(downstream)).toBe("downstream");
    expect(upstream.data?.[EDGE_FOCUS_ACTIVE_KEY]).toBe(true);
    expect(downstream.data?.[EDGE_FOCUS_ACTIVE_KEY]).toBe(true);
  });

  it("取消选中：标记被清干净，不残留压暗开关", () => {
    const sink = renderStage();
    toggleSelected(sink, "2", true);
    expect(readEdgeFocusRole(edgeById(sink, "e-1-2"))).toBe("upstream");

    toggleSelected(sink, "2", false);
    for (const edge of sink.edges) {
      expect(readEdgeFocusRole(edge)).toBe("none");
      expect(edge.data?.[EDGE_FOCUS_ACTIVE_KEY]).toBeUndefined();
    }
  });

  it("多选相邻两个节点：两端都选中判为 related，另一端仍按方向算", () => {
    const sink = renderStage();
    toggleSelected(sink, "1", true);
    toggleSelected(sink, "2", true);
    expect(readEdgeFocusRole(edgeById(sink, "e-1-2"))).toBe("related");
    /* e-2-3 只有节点 2 是选中端 → 仍是下游。 */
    expect(readEdgeFocusRole(edgeById(sink, "e-2-3"))).toBe("downstream");
  });

  it("自定义端点解析：折叠锚点归位后仍能识别上下游", () => {
    const sink = renderStage({
      nodeIds: ["2"],
      edges: ANCHOR_EDGES,
      /* 锚点 `anchor:2` 归位到节点 2；`anchor:1` / `anchor:3` 刻意解析不出去 ——
       * 正是折叠态下那些「看似没有对应节点」的端点，判据必须仍能靠剩下的一端
       * 认出相关性。 */
      resolveNodeId: (visualNodeId) =>
        visualNodeId === "anchor:2" ? "2" : null,
    });
    toggleSelected(sink, "2", true);
    expect(readEdgeFocusRole(edgeById(sink, "e-anchor-in"))).toBe("upstream");
    expect(readEdgeFocusRole(edgeById(sink, "e-anchor-out"))).toBe(
      "downstream",
    );
  });
});
