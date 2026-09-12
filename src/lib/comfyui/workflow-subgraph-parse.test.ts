/* 子图暴露口的「作者名」回收（ISSUE #349）。
 *
 * ComfyUI 在某些导出路径上把 `properties.proxyWidgets` 隔离掉，顶层富化于是
 * 拿不到内部节点的业务名，只剩本层别名槽位（`value_1`）。作者写的名字还留在
 * 外层 wrapper 的 `inputs[].label` 上，而内层视图的 wrapper 边界记录（`-10`
 * 哨兵边的目标节点 + 槽位）认得同一个暴露口 —— 两者一对就能把作者名交回上层。
 */
import { describe, expect, it } from "vitest";

import {
  boundarySlotsByNode,
  buildBoundaryLinks,
  buildSubgraphGraph,
  parseSubgraphLinks,
  parseSubgraphPins,
  reportDroppedBoundaryLinks,
} from "./workflow-subgraph-parse";
import type { RawNodeInput, RawSubgraphDef } from "./raw";

/** 最小子图定义：wrapper 暴露 value_1（作者名 Seed），内层 PrimitiveInt 消费它。 */
function makeSub(extra: Record<string, unknown> = {}): RawSubgraphDef {
  return {
    id: "e0940f57-80b2-480e-8a38-36968dc1763d",
    name: "WAN22 I2V",
    inputs: [{ name: "value_1", label: "Seed", linkIds: [7] }],
    outputs: [],
    links: [
      { id: 7, origin_id: -10, origin_slot: 0, target_id: 1670, target_slot: 0, type: "INT" },
    ],
    nodes: [
      {
        id: 1670,
        type: "PrimitiveInt",
        inputs: [{ name: "value", idx: 0, type: "INT", widget: { name: "value" }, link: 7 }],
        outputs: [{ name: "INT", links: [] }],
        widgets_values: [42],
      },
    ],
    ...extra,
  };
}

describe("buildSubgraphGraph — 子图暴露口的作者名", () => {
  it("按哨兵边的内层槽位名回收 wrapper 上的作者 label", () => {
    const sub = makeSub();
    const { linkById } = parseSubgraphLinks(sub);
    const labels: Record<string, string> = buildSubgraphGraph(sub, linkById).proxyAuthorLabels;
    expect(labels["1670::value"]).toBe("Seed");
  });

  it("没有作者名（wrapper 未命名）时不产出条目", () => {
    const sub = makeSub({ inputs: [{ name: "value_1", linkIds: [7] }] });
    const { linkById } = parseSubgraphLinks(sub);
    expect(buildSubgraphGraph(sub, linkById).proxyAuthorLabels).toEqual({});
  });

  /* 同名内部槽位（四个 PrimitiveInt 的 `value`）各自记自己的作者名 ——
   *  只按槽位名记账会被后写的暴露口覆盖，`Seed` 节点于是显示成 `FPS`
   *  （ISSUE #394）。 */
  it("多个节点共用同一槽位名时各记各的作者名，不互相覆盖", () => {
    const sub = makeSub({
      inputs: [
        { name: "value_1", label: "Seed", linkIds: [7] },
        { name: "value_3", label: "FPS", linkIds: [8] },
      ],
      links: [
        { id: 7, origin_id: -10, origin_slot: 34, target_id: 1670, target_slot: 0, type: "INT" },
        { id: 8, origin_id: -10, origin_slot: 36, target_id: 1669, target_slot: 0, type: "FLOAT" },
      ],
      nodes: [
        {
          id: 1670,
          type: "PrimitiveInt",
          inputs: [{ name: "value", idx: 0, type: "INT", widget: { name: "value" }, link: 7 }],
          outputs: [{ name: "INT", links: [] }],
          widgets_values: [42],
        },
        {
          id: 1669,
          type: "PrimitiveFloat",
          inputs: [{ name: "value", idx: 0, type: "FLOAT", widget: { name: "value" }, link: 8 }],
          outputs: [{ name: "FLOAT", links: [] }],
          widgets_values: [16],
        },
      ],
    });
    const { linkById } = parseSubgraphLinks(sub);
    const labels = buildSubgraphGraph(sub, linkById).proxyAuthorLabels;
    expect(labels["1670::value"]).toBe("Seed");
    expect(labels["1669::value"]).toBe("FPS");
  });

  it("哨兵边指向的槽位名找不到时静默跳过（不产出脏键）", () => {
    const sub = makeSub({
      nodes: [{ id: 1670, type: "PrimitiveInt", inputs: [], outputs: [] }],
    });
    const { linkById } = parseSubgraphLinks(sub);
    expect(buildSubgraphGraph(sub, linkById).proxyAuthorLabels).toEqual({});
  });
});

describe("buildSubgraphGraph — 节点作者标题", () => {
  /* ComfyUI properties 里改过名的节点（`title`）必须在子图内部也生效 ——
   * 画布标题栏按 `friendlyNodeTitle(classType, title)` 取名，作者名优先于
   * classType 的静态名（ISSUE #394：`PrimitiveInt` + `title: "Seed"` 一直
   * 显示成 "Primitive Int"）。 */
  it("把内层节点的 raw title 带进 graph._meta 与 node.title", () => {
    const sub = makeSub({
      nodes: [
        {
          id: 1670,
          type: "PrimitiveInt",
          title: "Seed",
          inputs: [{ name: "value", idx: 0, type: "INT", widget: { name: "value" }, link: null }],
          outputs: [{ name: "INT", links: [] }],
          widgets_values: [42],
        },
      ],
    });
    const { linkById } = parseSubgraphLinks(sub);
    const result = buildSubgraphGraph(sub, linkById);
    expect(result.graph["1670"]!._meta?.title).toBe("Seed");
    expect(result.nodes.find((n) => n.id === "1670")!.title).toBe("Seed");
  });

  it("没有作者标题时不产出 _meta（回退 classType 显示名）", () => {
    const sub = makeSub();
    const { linkById } = parseSubgraphLinks(sub);
    const result = buildSubgraphGraph(sub, linkById);
    expect(result.graph["1670"]!._meta).toBeUndefined();
    expect(result.nodes.find((n) => n.id === "1670")!.title).toBe("PrimitiveInt");
  });
});

describe("buildBoundaryLinks — 暴露口的槽位名必须是画布上真实存在的那一行", () => {
  /* ISSUE #441：React Flow 报 `Couldn't create edge for target handle id: "in"`
   * （error#008）。根因是边界连线的 targetHandle 解析不出槽位名、落到兜底字面量
   * `"in"`，而画布上并没有这个 handle —— 整条边被静默丢弃，「这个暴露口从来没
   * 连上」。
   *
   * 触发条件是**槽位下标口径不一致**：ComfyUI 的 `target_slot` 写在「控件序号」
   * 空间（跳过 `model`/`negative` 这类纯连接口），而 `inputs[]` 的位置是另一个
   * 空间。哨兵边记下的关联才是权威事实，`parseSubgraphSlots` 按它解析。 */

  /** 复刻 ISSUE 报文的内层节点：`model`/`negative` 是纯连接口，`seed` 是控件槽。 */
  function makeConsumerSub(opts: {
    targetSlot: number;
    seedIdx: number;
    /** seed 在 raw `inputs[]` 里的数组位置（缺省 = 紧跟两个纯连接口之后）。 */
    seedArrayIndex?: number;
  }): RawSubgraphDef {
    /* 前两行是纯连接口，中间补若干占位槽 —— 让「控件序号空间」与「数组位置
     * 空间」在下标上真的错开，测试才有区分度。 */
    const seedAt = opts.seedArrayIndex ?? 2;
    const slots: RawNodeInput[] = [];
    for (let index = 0; index <= Math.max(seedAt, 2); index++) {
      if (index === seedAt) {
        slots.push({ name: "seed", idx: opts.seedIdx, type: "INT", widget: { name: "seed" }, link: 7 });
      } else if (index === 0) {
        slots.push({ name: "model", idx: 0, type: "MODEL" });
      } else if (index === 1) {
        slots.push({ name: "negative", idx: 1, type: "CONDITIONING" });
      } else {
        slots.push({ name: `extra_${index}`, idx: index, type: "FLOAT" });
      }
    }
    return {
      id: "e0940f57-80b2-480e-8a38-36968dc1763d",
      name: "WAN22 I2V",
      inputs: [{ id: "pin-1", name: "value_1", label: "Seed", linkIds: [7] }],
      outputs: [],
      links: [
        {
          id: 7,
          origin_id: -10,
          origin_slot: 0,
          target_id: 5277,
          target_slot: opts.targetSlot,
          type: "INT",
        },
      ],
      nodes: [
        {
          id: 5277,
          type: "KSampler",
          inputs: slots,
          outputs: [{ name: "LATENT", links: [] }],
          widgets_values: [123, "randomize"],
        },
      ],
    };
  }

  /** 走一遍「服务端解析 → 客户端组装 handle id」的完整链路。 */
  function resolveTargetHandle(sub: RawSubgraphDef): string | null {
    const { linkById, boundaryLinkInfoById } = parseSubgraphLinks(sub);
    const sg = buildSubgraphGraph(sub, linkById, boundarySlotsByNode(boundaryLinkInfoById));
    const { pinIdByLinkId } = parseSubgraphPins(sub);
    const links = buildBoundaryLinks(
      boundaryLinkInfoById,
      pinIdByLinkId,
      sg.inputNameByNodeSlot,
      sg.outputNameByNodeSlot
    );
    /* 与 `workflow-utils.buildEdges` 的组装口径逐字一致：槽位名缺席时退化成
     * 字面量 `"in"` —— 那正是 error#008 里那个不存在的 handle。 */
    return links[0] ? links[0].innerSlotName || "in" : null;
  }

  it("target_slot 落在 inputs[] 下标空间时解析到 seed", () => {
    expect(resolveTargetHandle(makeConsumerSub({ targetSlot: 2, seedIdx: 2 }))).toBe("seed");
  });

  it("target_slot 落在控件序号空间时同样解析到 seed", () => {
    /* ComfyUI 报的是**控件序号**（跳过 model/negative 这类纯连接口），而
     * `inputs[]` 的位置是另一个空间：控件序号 7 在这份报文里指向的是
     * `inputs[6]`。修复前按 inputs[] 下标查会落空 → handle 退化成 `"in"`，
     * 正是 ISSUE 里那条 `e-bb-5277-in`。 */
    const sub = makeConsumerSub({ targetSlot: 6, seedIdx: 2, seedArrayIndex: 6 });
    expect(resolveTargetHandle(sub)).toBe("seed");
  });

  it("控件槽 idx 从 0 连续编号（跳过纯连接口）时不串到 model", () => {
    /* 有的导出路径给 widget 槽写 `idx: 1`（> 前面纯连接口的数量）——照抄 idx
     * 会把线锚到 model 那一行，值落错端口。哨兵边口径不受 idx 影响。 */
    expect(resolveTargetHandle(makeConsumerSub({ targetSlot: 2, seedIdx: 1 }))).toBe("seed");
  });

  it("哨兵边指向不存在的槽位时不产出边（不再落成字面量 in）", () => {
    expect(resolveTargetHandle(makeConsumerSub({ targetSlot: 9, seedIdx: 2 }))).toBeNull();
  });

  it("边界落点与控件值取的是同一行（seed 拿到哨兵边的控件值）", () => {
    const { linkById, boundaryLinkInfoById } = parseSubgraphLinks(
      makeConsumerSub({ targetSlot: 5, seedIdx: 2 })
    );
    const sg = buildSubgraphGraph(makeConsumerSub({ targetSlot: 5, seedIdx: 2 }), linkById, boundarySlotsByNode(boundaryLinkInfoById));
    expect(sg.graph["5277"]?.inputs?.seed).toBe(123);
  });

  it("被丢掉的边界连线会点名上报（不是静默跳过）", () => {
    const sub = makeConsumerSub({ targetSlot: 9, seedIdx: 2 });
    const { boundaryLinkInfoById } = parseSubgraphLinks(sub);
    const { pinIdByLinkId } = parseSubgraphPins(sub);
    const dropped = reportDroppedBoundaryLinks(sub, boundaryLinkInfoById, pinIdByLinkId, []);
    expect(dropped).toEqual([
      { linkId: 7, pinId: "pin-1", innerNodeId: "5277", innerSlot: 9 },
    ]);
  });

  it("正常产出的边不算「被丢掉」", () => {
    const sub = makeConsumerSub({ targetSlot: 2, seedIdx: 2 });
    const { boundaryLinkInfoById } = parseSubgraphLinks(sub);
    const { pinIdByLinkId } = parseSubgraphPins(sub);
    const produced = [
      { linkId: 7, kind: "input" as const, pinId: "pin-1", innerNodeId: "5277", innerSlotName: "seed" },
    ];
    expect(reportDroppedBoundaryLinks(sub, boundaryLinkInfoById, pinIdByLinkId, produced)).toEqual([]);
  });
});
