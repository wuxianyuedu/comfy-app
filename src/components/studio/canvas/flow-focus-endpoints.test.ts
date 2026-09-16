// 选中节点的「相关连线」判据（纯函数）—— 上下游识别、无关连线降噪、边界情况。
//
// 判据本身只有一句话：一条线的两个端点解析到选中节点 → 这条线与它相关。
// 但这句话有三处容易写歪的地方，都固化成用例：
//   1. 方向：谁是源、谁是目标决定「上游 / 下游」，写反了用户会看到相反的箭头语义；
//   2. 解析：端点解析不出来（不在当前图里）时不能当成「无关」——那会让一条明明
//      连着的线不高亮（折叠锚点、合成端点都会走到这条路径）；
//   3. 降噪：只有「画布上有选中项」时无关连线才该变淡，否则单纯滚动 / 阅读画布
//      会因为一次误点整片发灰。

import { describe, expect, it } from "vitest";

import { resolveEdgeFocus, shouldDimEdge } from "./flow-focus-endpoints";

/** 恒等解析：端点 id 就是节点 id（大多数画布的情形）。 */
const identity = (visualNodeId: string) => visualNodeId;

function focusOf(
  endpoints: { source: string | null; target: string | null },
  selected: readonly string[],
) {
  const selectedSet = new Set(selected);
  return resolveEdgeFocus({
    endpoints,
    resolveNodeId: identity,
    isSelected: (nodeId) => selectedSet.has(nodeId),
  });
}

describe("resolveEdgeFocus", () => {
  it("目标端是选中节点 → 上游（这条线流进选中节点）", () => {
    expect(focusOf({ source: "1", target: "7" }, ["7"])).toBe("upstream");
  });

  it("源端是选中节点 → 下游（这条线从选中节点流出）", () => {
    expect(focusOf({ source: "7", target: "9" }, ["7"])).toBe("downstream");
  });

  it("两端都与选中节点无关 → none", () => {
    expect(focusOf({ source: "1", target: "2" }, ["7"])).toBe("none");
  });

  it("没有任何选中节点 → 所有线都是 none", () => {
    expect(focusOf({ source: "7", target: "9" }, [])).toBe("none");
  });

  it("两端都是选中节点（多选）→ 相关但无单一方向", () => {
    expect(focusOf({ source: "7", target: "8" }, ["7", "8"])).toBe("related");
  });

  it("自环（源 = 目标 = 选中节点）→ related，不会误判成上游或下游", () => {
    expect(focusOf({ source: "7", target: "7" }, ["7"])).toBe("related");
  });

  it("端点解析不出来（不在当前图里）→ 不当作选中，回落 none", () => {
    const focus = resolveEdgeFocus({
      endpoints: { source: "ghost", target: "ghost2" },
      resolveNodeId: () => null,
      isSelected: () => true,
    });
    expect(focus).toBe("none");
  });

  it("折叠锚点：端点 id 与选中节点 id 不同名时，靠 resolveNodeId 归位", () => {
    /* 折叠节点用锚点 id 渲染，边挂在锚点上；选中事实源却是业务节点 id。 */
    const focus = resolveEdgeFocus({
      endpoints: { source: "collapse:7", target: "9" },
      resolveNodeId: (visualNodeId) =>
        visualNodeId === "collapse:7"
          ? "7"
          : visualNodeId === "9"
            ? null
            : null,
      isSelected: (nodeId) => nodeId === "7",
    });
    expect(focus).toBe("downstream");
  });

  it("端点缺失（null）不参与判定，不抛错", () => {
    expect(focusOf({ source: null, target: "7" }, ["7"])).toBe("upstream");
    expect(focusOf({ source: "7", target: null }, ["7"])).toBe("downstream");
    expect(focusOf({ source: null, target: null }, ["7"])).toBe("none");
  });
});

describe("shouldDimEdge", () => {
  it("有选中项且这条线无关 → 降噪", () => {
    expect(shouldDimEdge({ focus: "none", hasSelection: true })).toBe(true);
  });

  it("有选中项但这条线相关 → 不降噪", () => {
    expect(shouldDimEdge({ focus: "upstream", hasSelection: true })).toBe(
      false,
    );
    expect(shouldDimEdge({ focus: "downstream", hasSelection: true })).toBe(
      false,
    );
    expect(shouldDimEdge({ focus: "related", hasSelection: true })).toBe(false);
  });

  it("没有选中项 → 全图保持原样（不因一次误点整片发灰）", () => {
    expect(shouldDimEdge({ focus: "none", hasSelection: false })).toBe(false);
  });
});
