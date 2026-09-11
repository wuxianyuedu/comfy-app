/**
 * 子图内部节点覆盖项的**确定性定位**（ISSUE #349 后续）。
 *
 * 运行期 comfy-cli 展开子图后的节点 id 是 `宿主id:内部id`（嵌套时
 * `宿主id:内层宿主id:内部id`）。落库时把宿主 id 链与内部节点 id 都存下来，
 * 这里验证 `applyRawOverrides` 能按这条链逐层下钻写对内层节点的
 * `widgets_values` —— 而不是「拿裸 id 去所有子图定义里扫一遍」。
 */
import { describe, it, expect } from "vitest";

import { applyRawOverrides } from "./raw-overrides";

const INNER_UUID = "9b9009e4-2d3d-445f-9be5-6063f465757e";
const NESTED_UUID = "11112222-2d3d-445f-9be5-6063f465757e";

/** 一个内部节点（PrimitiveInt）：只暴露一个 `value` 控件。 */
function primitiveInt(id: string, value: number) {
  return {
    id,
    type: "PrimitiveInt",
    inputs: [{ name: "value", widget: { name: "value" } }],
    widgets_values: [value],
  };
}

/** 外层 wrapper + 它的子图定义（内部含一个 PrimitiveInt 与一个嵌套 wrapper）。 */
function nestedRaw() {
  return {
    nodes: [
      {
        id: 4,
        type: INNER_UUID,
        inputs: [],
        widgets_values: [],
      },
    ],
    definitions: {
      subgraphs: {
        [INNER_UUID]: {
          id: INNER_UUID,
          nodes: [
            primitiveInt("1670", 1),
            {
              id: 5,
              type: NESTED_UUID,
              inputs: [],
              widgets_values: [],
            },
          ],
        },
        [NESTED_UUID]: {
          id: NESTED_UUID,
          nodes: [primitiveInt("1670", 7)],
        },
      },
    },
  };
}

function widgetsOf(raw: unknown, subgraphUid: string, innerId: string): unknown[] {
  const r = raw as {
    definitions: { subgraphs: Record<string, { nodes: { id: string; widgets_values: unknown[] }[] }> };
  };
  const node = r.definitions.subgraphs[subgraphUid]!.nodes.find((n) => n.id === innerId)!;
  return node.widgets_values;
}

describe("resolveRawNode — 拼接 id 逐层下钻", () => {
  it("`宿主:内部` 写进对应子图定义里的内部节点", () => {
    const raw = nestedRaw();
    const result = applyRawOverrides(raw, [
      { nodeId: "4:1670", name: "value", value: 42 },
    ]);

    expect(widgetsOf(result, INNER_UUID, "1670")).toEqual([42]);
    /* 嵌套子图里同名的内部节点 1670 不受影响（正是「裸 id 扫描」会写错的场景）。 */
    expect(widgetsOf(result, NESTED_UUID, "1670")).toEqual([7]);
  });

  it("嵌套的 `宿主:内层宿主:内部` 三层链路也能写对", () => {
    const raw = nestedRaw();
    const result = applyRawOverrides(raw, [
      { nodeId: "4:5:1670", name: "value", value: 99 },
    ]);

    expect(widgetsOf(result, NESTED_UUID, "1670")).toEqual([99]);
    expect(widgetsOf(result, INNER_UUID, "1670")).toEqual([1]);
  });

  it("链路中断（宿主 id 不存在）时落空，不误写到别处", () => {
    const raw = nestedRaw();
    const result = applyRawOverrides(raw, [
      { nodeId: "999:1670", name: "value", value: 5 },
    ]);

    expect(widgetsOf(result, INNER_UUID, "1670")).toEqual([1]);
    expect(widgetsOf(result, NESTED_UUID, "1670")).toEqual([7]);
  });

  it("顶层节点 id 仍原样定位", () => {
    const raw = {
      nodes: [
        {
          id: "24",
          type: "LoadImage",
          inputs: [{ name: "image", widget: { name: "image" } }],
          widgets_values: ["old.png"],
        },
      ],
      links: [],
    };
    const result = applyRawOverrides(raw, [
      { nodeId: "24", name: "image", value: "new.png" },
    ]) as { nodes: { id: string; widgets_values: unknown[] }[] };

    expect(result.nodes[0]!.widgets_values).toEqual(["new.png"]);
  });

  it("存量裸内部 id（没有宿主前缀）仍按子图定义兜底定位", () => {
    const raw = nestedRaw();
    const result = applyRawOverrides(raw, [
      { nodeId: "1670", name: "value", value: 3 },
    ]);

    /* 旧数据只存内部 id：为已在库的行保留兜底，找得到就落值。 */
    expect(widgetsOf(result, INNER_UUID, "1670")).toEqual([3]);
  });
});
