/* 子图暴露口的「作者名」回收（ISSUE #349）。
 *
 * ComfyUI 在某些导出路径上把 `properties.proxyWidgets` 隔离掉，顶层富化于是
 * 拿不到内部节点的业务名，只剩本层别名槽位（`value_1`）。作者写的名字还留在
 * 外层 wrapper 的 `inputs[].label` 上，而内层视图的 wrapper 边界记录（`-10`
 * 哨兵边的目标节点 + 槽位）认得同一个暴露口 —— 两者一对就能把作者名交回上层。
 */
import { describe, expect, it } from "vitest";

import { buildSubgraphGraph, parseSubgraphLinks } from "./workflow-subgraph-parse";
import type { RawSubgraphDef } from "./raw";

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
