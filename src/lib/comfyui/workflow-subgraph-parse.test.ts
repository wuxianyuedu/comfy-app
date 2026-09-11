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
    expect(labels.value).toBe("Seed");
  });

  it("没有作者名（wrapper 未命名）时不产出条目", () => {
    const sub = makeSub({ inputs: [{ name: "value_1", linkIds: [7] }] });
    const { linkById } = parseSubgraphLinks(sub);
    expect(buildSubgraphGraph(sub, linkById).proxyAuthorLabels).toEqual({});
  });

  it("哨兵边指向的槽位名找不到时静默跳过（不产出脏键）", () => {
    const sub = makeSub({
      nodes: [{ id: 1670, type: "PrimitiveInt", inputs: [], outputs: [] }],
    });
    const { linkById } = parseSubgraphLinks(sub);
    expect(buildSubgraphGraph(sub, linkById).proxyAuthorLabels).toEqual({});
  });
});
