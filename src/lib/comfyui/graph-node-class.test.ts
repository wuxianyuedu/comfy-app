import { describe, expect, it } from "vitest";

import { classTypeForNode } from "./graph-node-class";

/* ISSUE #1202：WS 的 `executing` / `progress` 帧只带节点 id，认类名要靠
 * 「真正提交出去的那张图」。那份图有两种形状，取决于提交入口给的是 API 图还是
 * RAW 原件 —— 两种都必须认得出，否则用户看到的还是「未知节点（?）」。 */
describe("classTypeForNode", () => {
  it("API 形状：键就是节点 id，类名在 class_type", () => {
    const graph = {
      "3": { class_type: "KSampler", inputs: { seed: [1, 0] } },
      "7": { class_type: "VAEDecode", inputs: {} },
    };
    expect(classTypeForNode(graph, "3")).toBe("KSampler");
    expect(classTypeForNode(graph, "7")).toBe("VAEDecode");
  });

  it("RAW（UI 格式）形状：类名在 nodes[].type，id 是数字也要按字符串认", () => {
    const graph = {
      nodes: [
        { id: 3, type: "KSampler", inputs: [], widgets_values: [] },
        { id: 7, type: "VAEDecode", inputs: [], widgets_values: [] },
      ],
      links: [],
    };
    expect(classTypeForNode(graph, "7")).toBe("VAEDecode");
    /* comfy-cli 展开子图后 WS 回来的是带宿主链的 id（`4:1670`）——
     * 定位必须与画布覆盖注入那条（raw-overrides 的 resolveRawNode）同一条。 */
    const withSubgraph = {
      nodes: [{ id: 4, type: "SUBGRAPH_ID", inputs: [], widgets_values: [] }],
      definitions: {
        // 子图定义按 `id` 登记（`SubgraphIdentitySchema`），wrapper 的 `type` 指它。
        subgraphs: [
          {
            id: "SUBGRAPH_ID",
            nodes: [{ id: 1670, type: "CLIPTextEncode", inputs: [] }],
          },
        ],
      },
    };
    expect(classTypeForNode(withSubgraph, "4:1670")).toBe("CLIPTextEncode");
  });

  it("两种形状同时能命中时按 API 优先（真实提交件里只会有一种，这条钉住不漂移）", () => {
    const graph = {
      "3": { class_type: "KSampler" },
      nodes: [{ id: 3, type: "FromUiShape" }],
    };
    expect(classTypeForNode(graph, "3")).toBe("KSampler");
  });

  it("认不出就是 undefined，绝不猜", () => {
    expect(classTypeForNode({ "9": { class_type: "" } }, "9")).toBeUndefined();
    expect(
      classTypeForNode({ nodes: [{ id: 1, type: "" }] }, "1"),
    ).toBeUndefined();
    expect(classTypeForNode({ nodes: [] }, "3")).toBeUndefined();
    expect(classTypeForNode({}, "3")).toBeUndefined();
    /* 载荷不可信：null / undefined / 字符串 / 数字 / 数组 / 空图都不许抛，也认不出。 */
    for (const bad of [null, undefined, "graph", 42, [], {}]) {
      expect(() => classTypeForNode(bad, "3")).not.toThrow();
      expect(classTypeForNode(bad, "3")).toBeUndefined();
    }
    /* 空 id 不该误命中 API 形状里的某个键。 */
    expect(classTypeForNode({ "": { class_type: "X" } }, "")).toBeUndefined();
  });
});
