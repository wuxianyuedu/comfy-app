// 执行期装载链生成的行为契约（#4376）：
//  1) 计划命中的端点按预设实例化「LoadImage → 处理节点…」子图并连到目标入口，
//     文件名覆盖项改写到新 LoadImage 的 image 部件（与裸增强同一落点）；
//  2) 同一文件名喂多个端点 = 各自一条链（扇出）；
//  3) 不在计划里 / 目录缺类 / 目标不是张量连线口 → 原样放行（回落裸增强）；
//  4) MASK 入口挑链尾的 MASK 出口，链尾没有 MASK 出口则回落；
//  5) 原图不被修改（深拷贝，幂等重跑）。
// API 格式同一套语义，落点形状不同（连线值 = [源节点, 槽]）。
import { describe, expect, it } from "vitest";

import type { ReferenceChainCatalog } from "./reference-loader-catalog";
import {
  applyReferenceLoaderChainsApi,
  applyReferenceLoaderChainsRaw,
  plannedEndpointCount,
  referenceLoaderEndpointKey,
} from "./reference-loader-chain";
import type { ReferenceLoaderPreset } from "~/lib/workshop/reference-loader-preset";

const CATALOG: ReferenceChainCatalog = {
  ResizeImageMaskNode: {
    className: "ResizeImageMaskNode",
    inputs: [
      { name: "输入", type: "IMAGE", wire: true },
      { name: "调整类型", type: "COMBO", wire: false },
      { name: "megapixels", type: "FLOAT", wire: false },
      { name: "multiple", type: "INT", wire: false },
      { name: "缩放方法", type: "COMBO", wire: false },
    ],
    outputs: [{ name: "已调整大小", type: "IMAGE", wire: false }],
    widgetOrder: ["调整类型", "megapixels", "multiple", "缩放方法"],
    defaults: { 调整类型: "scale total pixels", megapixels: 4, multiple: 32, 缩放方法: "area" },
    choices: { 调整类型: ["scale total pixels", "scale to multiple"], 缩放方法: ["area"] },
  },
  MaskSplitter: {
    className: "MaskSplitter",
    inputs: [{ name: "mask", type: "MASK", wire: true }],
    outputs: [
      { name: "IMAGE", type: "IMAGE", wire: false },
      { name: "MASK", type: "MASK", wire: false },
    ],
    widgetOrder: [],
    defaults: {},
    choices: {},
  },
};

const PRESET: ReferenceLoaderPreset = {
  id: "resize-align",
  name: "缩放对齐",
  steps: [
    { class: "ResizeImageMaskNode", widgets: { megapixels: 4 } },
    { class: "ResizeImageMaskNode", widgets: { 调整类型: "scale to multiple", multiple: 32 } },
  ],
};

/** 测试里的 RAW 图视图（引擎返回 unknown，这里按夹具形状收窄）。 */
type FixtureNode = {
  id: number;
  inputs: Array<Record<string, unknown>>;
  outputs: Array<Record<string, unknown>>;
  type: string;
  widgets_values?: Array<unknown>;
};
type FixtureGraph = {
  last_link_id?: number;
  last_node_id?: number;
  links: Array<Array<unknown>>;
  nodes: Array<FixtureNode>;
};
const asGraph = (graph: unknown): FixtureGraph =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 测试夹具形状自控
  graph as FixtureGraph;

/** 目标工作流：MiniMax 条件节点的 image_1 是未连线的张量入口。
 *  返回图本体与目标节点（往它身上加输入口时不必碰 `nodes[0]` 断言）。 */
function rawFixture(): { graph: FixtureGraph; target: FixtureNode } {
  const target: FixtureNode = {
    id: 69,
    type: "MiniMaxH3ImageConditioning",
    inputs: [
      { name: "image_0", type: "IMAGE", link: 10 },
      { name: "image_1", type: "IMAGE", link: null },
    ],
    outputs: [{ name: "positive", type: "CONDITIONING", links: null }],
    widgets_values: [],
  };
  return {
    graph: {
      last_node_id: 69,
      last_link_id: 10,
      nodes: [target],
      links: [[10, 1, 0, 69, 0, "IMAGE"]],
    },
    target,
  };
}

describe("RAW 装载链生成", () => {
  it("按预设实例化 LoadImage → 处理链并连到目标入口，文件名改写到新装载节点", () => {
    const { graph: raw } = rawFixture();
    const overrides = [{ nodeId: "69", name: "image_1", value: "ref.png" }];
    const plan = { [referenceLoaderEndpointKey("69", "image_1")]: PRESET };

    const result = applyReferenceLoaderChainsRaw(raw, overrides, plan, CATALOG);

    expect(result.added).toBe(1);
    const { nodes, links } = asGraph(result.graph);
    expect(nodes).toHaveLength(4);
    const loader = nodes.find((n) => n.type === "LoadImage");
    expect(loader).toBeDefined();
    expect(loader?.widgets_values).toEqual(["ref.png", "image"]);
    expect(loader!.id > 69).toBe(true);
    /* 控件值：预设给的优先，缺的回落类默认值，按 widgetOrder 摆位。 */
    const firstStep = nodes.find((n) => n.id === loader!.id + 1);
    expect(firstStep?.widgets_values).toEqual(["scale total pixels", 4, 32, "area"]);
    const lastStep = nodes.find((n) => n.id === loader!.id + 2);
    expect(lastStep?.widgets_values).toEqual(["scale to multiple", 4, 32, "area"]);
    /* 串接 + 落到目标入口的连线。 */
    expect(links.some((l) => l[1] === loader!.id && l[3] === loader!.id + 1)).toBe(true);
    expect(links.some((l) => l[1] === loader!.id + 1 && l[3] === loader!.id + 2)).toBe(true);
    expect(links.some((l) => l[1] === loader!.id + 2 && l[3] === 69)).toBe(true);
    const targetNode = nodes.find((n) => n.id === 69);
    /* 链占了 11/12/13 三条线：11=装载源→一级、12=一级→二级、13=二级→目标入口。 */
    expect(targetNode?.inputs[1]?.link).toBe(13);
    /* 覆盖项改写到新装载节点。 */
    expect(result.overrides).toEqual([
      { nodeId: String(loader!.id), name: "image", value: "ref.png" },
    ]);
    /* 原图不被修改。 */
    expect(raw.nodes).toHaveLength(1);
  });

  it("同一文件名喂多个端点 = 各自一条链（扇出）", () => {
    const { graph: raw, target } = rawFixture();
    target.inputs.push({ name: "image_2", type: "IMAGE", link: null });
    const overrides = [
      { nodeId: "69", name: "image_1", value: "ref.png" },
      { nodeId: "69", name: "image_2", value: "ref.png" },
    ];
    const plan = {
      [referenceLoaderEndpointKey("69", "image_1")]: PRESET,
      [referenceLoaderEndpointKey("69", "image_2")]: PRESET,
    };

    const result = applyReferenceLoaderChainsRaw(raw, overrides, plan, CATALOG);

    expect(result.added).toBe(2);
    expect(result.overrides).toHaveLength(2);
    const loaderIds = result.overrides.map((ov) => ov.nodeId);
    expect(new Set(loaderIds).size).toBe(2);
    const { links } = asGraph(result.graph);
    /* 两条链的链尾各自连到自己的目标入口（原 10 号线也指向 69，排除它）。 */
    expect(links.filter((l) => l[3] === 69 && l[0] !== 10)).toHaveLength(2);
  });

  it("不在计划里 / 目录缺类 / 部件口 → 原样放行（回落裸增强）", () => {
    const { graph: raw } = rawFixture();
    const overrides = [
      { nodeId: "69", name: "image_1", value: "ref.png" },
      { nodeId: "69", name: "prompt", value: "ref.png" },
      { nodeId: "69", name: "image_0", value: "other.png" },
    ];
    const plan = {
      [referenceLoaderEndpointKey("69", "image_1")]: {
        id: "bad",
        name: "缺类",
        steps: [{ class: "NoSuchNode" }],
      },
    };

    const result = applyReferenceLoaderChainsRaw(raw, overrides, plan, CATALOG);

    expect(result.added).toBe(0);
    expect(result.overrides).toEqual(overrides);
  });

  it("MASK 入口挑链尾的 MASK 出口；链尾没有 MASK 出口则回落", () => {
    const { graph: raw, target } = rawFixture();
    target.inputs.push({ name: "mask_0", type: "MASK", link: null });
    const maskPreset: ReferenceLoaderPreset = {
      id: "mask",
      name: "遮罩",
      steps: [{ class: "MaskSplitter" }],
    };
    const overrides = [
      { nodeId: "69", name: "mask_0", value: "ref.png" },
      { nodeId: "69", name: "image_1", value: "ref.png" },
    ];
    const plan = {
      [referenceLoaderEndpointKey("69", "mask_0")]: maskPreset,
      [referenceLoaderEndpointKey("69", "image_1")]: maskPreset,
    };

    const result = applyReferenceLoaderChainsRaw(raw, overrides, plan, CATALOG);

    const { links } = asGraph(result.graph);
    /* MASK 目标：链尾 MaskSplitter 的 1 号（MASK）出口。 */
    const maskLink = links.find((l) => l[5] === "MASK" && l[3] === 69 && l[0] !== 10);
    expect(maskLink?.[2]).toBe(1);
    /* IMAGE 目标配同一条预设（MaskSplitter 也有 IMAGE 出口）→ 正常连 0 号。 */
    const imageLink = links.find((l) => l[5] === "IMAGE" && l[3] === 69 && l[0] !== 10);
    expect(imageLink).toBeDefined();
  });

  it("目录不可用（ComfyUI 未就绪）→ 计划不生效，原样放行", () => {
    const { graph: raw } = rawFixture();
    const overrides = [{ nodeId: "69", name: "image_1", value: "ref.png" }];
    const plan = { [referenceLoaderEndpointKey("69", "image_1")]: PRESET };

    const result = applyReferenceLoaderChainsRaw(raw, overrides, plan, null);

    expect(result.added).toBe(0);
    expect(result.overrides).toEqual(overrides);
  });

  it("plannedEndpointCount 只数计划命中且值是文件名的覆盖项", () => {
    const overrides = [
      { nodeId: "69", name: "image_1", value: "ref.png" },
      { nodeId: "69", name: "image_0", value: "x.png" },
      { nodeId: "69", name: "prompt", value: 42 },
    ];
    const plan = {
      [referenceLoaderEndpointKey("69", "image_1")]: PRESET,
      [referenceLoaderEndpointKey("69", "prompt")]: PRESET,
    };
    expect(plannedEndpointCount(overrides, plan)).toBe(1);
  });
});

describe("API 装载链生成", () => {
  type ApiNode = { _meta: { title: string }; class_type: string; inputs: Record<string, unknown> };
  function apiFixture(): Record<string, ApiNode> {
    return {
      "69": {
        _meta: { title: "条件" },
        class_type: "MiniMaxH3ImageConditioning",
        inputs: { image_1: null, prompt: "猫" },
      },
    };
  }

  it("按预设实例化链并连到目标入口，文件名改写到新装载节点", () => {
    const graph = apiFixture();
    const overrides = [{ nodeId: "69", name: "image_1", value: "ref.png" }];
    const plan = { [referenceLoaderEndpointKey("69", "image_1")]: PRESET };

    const result = applyReferenceLoaderChainsApi(graph, overrides, plan, CATALOG);

    expect(result.added).toBe(1);
    /* SAFETY: 引擎返回 unknown；夹具形状自控，就地收窄（行级豁免，B5 清账口径）。 */
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const root = result.graph as Record<string, ApiNode>;
    expect(Object.keys(root)).toHaveLength(4);
    expect(root["70"]!.class_type).toBe("LoadImage");
    expect(root["70"]!.inputs).toMatchObject({ image: "ref.png" });
    expect(root["71"]!.inputs).toMatchObject({ 输入: ["70", 0], megapixels: 4 });
    expect(root["72"]!.inputs).toMatchObject({ 输入: ["71", 0], multiple: 32 });
    expect(root["69"]!.inputs.image_1).toEqual(["72", 0]);
    expect(result.overrides).toEqual([{ nodeId: "70", name: "image", value: "ref.png" }]);
  });

  it("部件值入口 / 目录缺类 → 原样放行", () => {
    const graph = apiFixture();
    const overrides = [
      { nodeId: "69", name: "prompt", value: "ref.png" },
      { nodeId: "69", name: "image_1", value: "ref.png" },
    ];
    const plan = {
      [referenceLoaderEndpointKey("69", "image_1")]: {
        id: "bad",
        name: "缺类",
        steps: [{ class: "NoSuchNode" }],
      },
    };

    const result = applyReferenceLoaderChainsApi(graph, overrides, plan, CATALOG);

    expect(result.added).toBe(0);
    expect(result.overrides).toEqual(overrides);
  });
});
