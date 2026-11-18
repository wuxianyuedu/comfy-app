import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";
import {
  augmentReferenceImageLoadersApi,
  augmentReferenceImageLoadersRaw,
} from "./reference-loader-augment";

/** MiniMax 形态的最小夹具：LoadImage（widget 口）+ 多参考条件节点（张量口
 *  `images.image_1..3`，无 widget、link 为 null）。 */
function rawFixture() {
  return {
    last_node_id: 69,
    last_link_id: 109,
    nodes: [
      {
        id: 45,
        type: "LoadImage",
        mode: 0,
        inputs: [
          { name: "image", type: "COMBO", widget: { name: "image" }, link: null },
          { name: "upload", type: "IMAGEUPLOAD", widget: { name: "upload" }, link: null },
        ],
        outputs: [{ name: "IMAGE", type: "IMAGE", links: [87] }],
        widgets_values: ["vintage_yellow_taxi.png", "image"],
        properties: { "Node name for S&R": "LoadImage" },
      },
      {
        id: 69,
        type: "MiniMaxH3ImageConditioning",
        mode: 0,
        inputs: [
          { name: "images.image_0", type: "IMAGE", link: 102 },
          { name: "images.image_1", type: "IMAGE", link: null },
          { name: "images.image_2", type: "IMAGE", link: null },
          { name: "images.image_3", type: "MASK", link: null },
        ],
        outputs: [{ name: "positive", type: "CONDITIONING", links: [105] }],
        properties: { "Node name for S&R": "MiniMaxH3ImageConditioning" },
      },
    ],
    links: [[102, 45, 0, 69, 0, "IMAGE"]],
  };
}

/** 从增强结果里按数字 id 取 RAW 节点（类型守卫收窄，不用断言）。 */
function rawNodeOf(graph: unknown, id: number): Record<string, unknown> | undefined {
  if (!isRecord(graph) || !Array.isArray(graph.nodes)) {
    return undefined;
  }
  const nodes: Array<unknown> = graph.nodes;
  const found = nodes.find((node) => isRecord(node) && node.id === id);
  return isRecord(found) ? found : undefined;
}

/** RAW 图的 links 数组（无则空）。 */
function rawLinks(graph: unknown): Array<unknown> {
  return isRecord(graph) && Array.isArray(graph.links) ? graph.links : [];
}

/** RAW 节点的 inputs 数组（无则空），逐项收窄成记录。 */
function rawInputsOf(node: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  return Array.isArray(node?.inputs)
    ? node.inputs.filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
}

/** API 图里按 id 取节点（类型守卫收窄，不用断言）。 */
function apiNodeOf(graph: unknown, id: string): Record<string, unknown> | undefined {
  if (!isRecord(graph)) {
    return undefined;
  }
  const node = graph[id];
  return isRecord(node) ? node : undefined;
}

/** API 节点的 inputs map（无则空）。 */
function apiInputsOf(node: Record<string, unknown> | undefined): Record<string, unknown> {
  const inputs = node?.inputs;
  return isRecord(inputs) ? inputs : {};
}

describe("augmentReferenceImageLoadersRaw", () => {
  it("张量图片入口：补 LoadImage 节点 + 连线，覆盖项改写到新节点", () => {
    const graph = rawFixture();
    const result = augmentReferenceImageLoadersRaw(graph, [
      { nodeId: "69", name: "images.image_1", value: "ref-2.png" },
    ]);

    expect(result.added).toBe(1);
    expect(result.overrides).toEqual([{ nodeId: "70", name: "image", value: "ref-2.png" }]);

    const loader = rawNodeOf(result.graph, 70);
    expect(loader?.type).toBe("LoadImage");
    expect(loader?.widgets_values).toEqual(["ref-2.png", "image"]);

    const targetInputs = rawInputsOf(rawNodeOf(result.graph, 69));
    expect(targetInputs[1]?.link).toBe(103);

    expect(rawLinks(result.graph)).toContainEqual([103, 70, 0, 69, 1, "IMAGE"]);
  });

  it("MASK 入口连 LoadImage 的遮罩出口（1 号槽），连线类型 MASK", () => {
    const result = augmentReferenceImageLoadersRaw(rawFixture(), [
      { nodeId: "69", name: "images.image_3", value: "mask.png" },
    ]);
    expect(rawLinks(result.graph)).toContainEqual([103, 70, 1, 69, 3, "MASK"]);
  });

  it("widget 口（LoadImage.image）不增强，覆盖项原样保留", () => {
    const graph = rawFixture();
    const result = augmentReferenceImageLoadersRaw(graph, [
      { nodeId: "45", name: "image", value: "main.png" },
    ]);
    expect(result.added).toBe(0);
    expect(result.overrides).toEqual([{ nodeId: "45", name: "image", value: "main.png" }]);
    expect(result.graph).toEqual(graph);
  });

  it("幂等：同一份原件两次增强结果一致，且原对象不被修改", () => {
    const graph = rawFixture();
    const snapshot = JSON.stringify(graph);
    const overrides = [
      { nodeId: "69", name: "images.image_1", value: "a.png" },
      { nodeId: "69", name: "images.image_2", value: "b.png" },
    ];
    const first = augmentReferenceImageLoadersRaw(graph, overrides);
    const second = augmentReferenceImageLoadersRaw(graph, overrides);
    expect(JSON.stringify(graph)).toBe(snapshot);
    expect(first).toEqual(second);
    expect(first.added).toBe(2);
  });

  it("同端口重复覆盖只补一个节点；子图 id 与非文件名值原样跳过", () => {
    const graph = rawFixture();
    const result = augmentReferenceImageLoadersRaw(graph, [
      { nodeId: "69", name: "images.image_1", value: "a.png" },
      { nodeId: "69", name: "images.image_1", value: "b.png" },
      { nodeId: "69:inner", name: "images.image_1", value: "c.png" },
      { nodeId: "69", name: "width", value: 1024 },
    ]);
    expect(result.added).toBe(1);
    expect(result.overrides).toContainEqual({
      nodeId: "69:inner",
      name: "images.image_1",
      value: "c.png",
    });
    expect(result.overrides).toContainEqual({ nodeId: "69", name: "width", value: 1024 });
  });

  it("没有覆盖项时原样返回", () => {
    const graph = rawFixture();
    expect(augmentReferenceImageLoadersRaw(graph, [])).toEqual({
      graph,
      overrides: [],
      added: 0,
    });
    expect(augmentReferenceImageLoadersRaw(graph, undefined).added).toBe(0);
  });
});

describe("augmentReferenceImageLoadersApi", () => {
  it("null 入参（未连续线口）：新增 LoadImage 节点并把入参改成连线引用", () => {
    const graph = {
      "45": {
        class_type: "LoadImage",
        inputs: { image: "vintage_yellow_taxi.png", upload: "image" },
      },
      "69": {
        class_type: "MiniMaxH3ImageConditioning",
        inputs: { "images.image_0": ["45", 0], "images.image_1": null },
      },
    };
    const result = augmentReferenceImageLoadersApi(graph, [
      { nodeId: "69", name: "images.image_1", value: "ref-2.png" },
    ]);

    expect(result.added).toBe(1);
    expect(result.overrides).toEqual([{ nodeId: "70", name: "image", value: "ref-2.png" }]);
    expect(apiNodeOf(result.graph, "70")?.class_type).toBe("LoadImage");
    expect(apiInputsOf(apiNodeOf(result.graph, "70"))).toEqual({
      image: "ref-2.png",
      upload: "image",
    });
    expect(apiInputsOf(apiNodeOf(result.graph, "69"))["images.image_1"]).toEqual(["70", 0]);
  });

  it("标量入参（widget 值）不增强；原图不被修改", () => {
    const graph = {
      "45": { class_type: "LoadImage", inputs: { image: "main.png", upload: "image" } },
    };
    const snapshot = JSON.stringify(graph);
    const result = augmentReferenceImageLoadersApi(graph, [
      { nodeId: "45", name: "image", value: "other.png" },
    ]);
    expect(result.added).toBe(0);
    expect(result.overrides).toEqual([{ nodeId: "45", name: "image", value: "other.png" }]);
    expect(JSON.stringify(graph)).toBe(snapshot);
  });
});
