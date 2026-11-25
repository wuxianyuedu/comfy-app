// 画布写回包装的行为契约（ISSUE #5037 回归）：
//  非受控画布（#4536）下 `rf.setNodes` 只是向 React Flow 的批量队列 push，flush
//  时按序归并、同批后写者覆盖先写者。包装器若在调用点用 `rf.getNodes()` 急切
//  解析成字面量数组，下钻子图那拍的顺序是「新图字面量 → 旧快照映射」，归并后
//  旧图覆盖新图 —— 画布停在父图、顶栏/面包屑却已切到子图；封装节点的下钻按钮
//  还在画布上，用户再点就再压一层同名面包屑（用户口径：「点击查看子工作流无效，
//  导致上方不断嵌套」）。
//  契约：包装器必须把 updater **透传**进队列，让它在 flush 时对「当次归并中的
//  最新图」求值 —— 同批「先 push 新图、再映射」的最终结果必须是新图映射后的结果。
import { useCallback, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, type Node } from "@xyflow/react";

import { useRfTableWriters } from "./use-rf-table-writers";

/* happy-dom 不含 ResizeObserver，而 <ReactFlow> 挂载期就会用它测量视口。
 * 桩成「只记录、从不回调」：本用例断言的是节点表状态，不依赖任何真实尺寸。 */
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

/* 父图（旧）与子图（新）两份最小节点表：id 不同，覆盖是否发生一查便知。 */
const PARENT_NODES: Array<Node> = [
  { id: "9", data: {}, position: { x: 0, y: 0 } },
  { id: "14", data: {}, position: { x: 300, y: 0 } },
  { id: "23", data: {}, position: { x: 600, y: 0 } },
];
const SUBGRAPH_NODES: Array<Node> = [
  { id: "1", data: {}, position: { x: 0, y: 0 } },
  { id: "7", data: {}, position: { x: 300, y: 0 } },
  { id: "8", data: {}, position: { x: 600, y: 0 } },
];

type Harness = {
  /** 同一拍里复刻下钻的两次写：先画布同步 effect 的新图字面量，再经包装器映射。 */
  drill: (newNodes: Array<Node>) => void;
  /** 纯 updater 写（paramMap 徽标同步的真实形态）。 */
  mapNodes: (updater: (nodes: Array<Node>) => Array<Node>) => void;
  nodeIds: () => Array<string>;
};

/** 排空批量队列：让 BatchProvider 的 layout effect 把攒下的 push 归并进 store。 */
async function flushQueue(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** 观测棚：hook 跑在真 Provider 里，测试侧经 sink 拿写入口与 store 读数。
 *  可变字段用 useEffect 发布（不在渲染期写对象），与既有 RF 用例同款。 */
function Probe({ sink }: { sink: { current: Harness | null } }) {
  const rf = useReactFlow();
  const { rfSetNodes } = useRfTableWriters(rf);
  const store = useStoreApi();
  const drill = useCallback(
    (newNodes: Array<Node>) => {
      /* 与编辑器同构的两拍：第一拍是画布同步 effect 的字面量 push（rf.setNodes
       * 直调），第二拍是 paramMap 重同步 effect 经包装器的 updater 写。两拍之间
       * 不 flush —— 批量队列正是把它们攒到同一次 flush 里归并。 */
      rf.setNodes(newNodes);
      rfSetNodes((nodes) =>
        nodes.map((node) => ({
          ...node,
          data: { ...node.data, assignedRole: "badge" },
        })),
      );
    },
    [rf, rfSetNodes],
  );
  const mapNodes = useCallback(
    (updater: (nodes: Array<Node>) => Array<Node>) => {
      rfSetNodes(updater);
    },
    [rfSetNodes],
  );
  const nodeIds = useCallback(() => store.getState().nodes.map((node) => node.id), [store]);
  useEffect(() => {
    sink.current = { drill, mapNodes, nodeIds };
  }, [drill, mapNodes, nodeIds, sink]);
  return null;
}

function renderProbe(): Harness {
  const sink: { current: Harness | null } = { current: null };
  render(
    <ReactFlowProvider>
      {/* 真画布负责把 hasDefaultNodes 置真（与编辑器同一条初始化链路）；
          被测 hook 与画布同仓一个 Provider，与编辑器本体/画布的相对位置一致。 */}
      <Probe sink={sink} />
      <ReactFlow defaultEdges={[]} defaultNodes={[]} nodesDraggable={false} />
    </ReactFlowProvider>,
  );
  const h = sink.current;
  if (h === null) {
    throw new Error("probe 未挂载");
  }
  return h;
}

describe("useRfTableWriters（非受控画布写回包装）", () => {
  it("同批「先 push 新图、再经包装器映射」时，最终 store 是新图映射后的结果（#5037 回归）", async () => {
    const h = renderProbe();
    await flushQueue();
    expect(h.nodeIds()).toEqual([]); // 画布从空表起步

    act(() => {
      h.drill(SUBGRAPH_NODES);
    });
    await flushQueue();

    /* 修复前：第二拍在调用点急切解析「flush 前的旧 store 快照」（空表），
     * 归并后旧快照覆盖新图 —— 这里拿到的将是空表，断言当场红。 */
    expect(h.nodeIds()).toEqual(["1", "7", "8"]);
  });

  it("包装器的 updater 对 flush 时刻的最新图求值，可与字面量 push 正确叠写", async () => {
    const h = renderProbe();
    await flushQueue();
    act(() => {
      h.mapNodes((nodes) => [...nodes, { id: "x1", data: {}, position: { x: 0, y: 0 } }]);
      h.mapNodes((nodes) => nodes.filter((node) => node.id !== "x1"));
    });
    await flushQueue();
    /* 两个 updater 按序归并：先加后删，最终不含 x1 —— 证明透传的 updater 是
     * 对「归并中的最新表」逐个求值，而不是各自对着调用时的旧快照各算各的。 */
    expect(h.nodeIds()).toEqual([]);
  });

  it("父图 → 子图的整拍切换后，画布数据是子图节点（父图不残留）", async () => {
    const h = renderProbe();
    await flushQueue();
    /* 预置父图：模拟「打开工作流后的顶层画布」。 */
    act(() => {
      h.mapNodes((nodes) => [...nodes, ...PARENT_NODES]);
    });
    await flushQueue();
    expect(h.nodeIds()).toEqual(["9", "14", "23"]);

    act(() => {
      h.drill(SUBGRAPH_NODES);
    });
    await flushQueue();
    /* 下钻后画布数据 = 子图节点（不是父图残留）——这正是用户报的「点了没反应」。 */
    expect(h.nodeIds()).toEqual(["1", "7", "8"]);
  });
});
