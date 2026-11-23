// 参考图装载计划构造的契约（#4376）：
//  1) 槽位绑定（预设）→「端点 → 预设」计划；
//  2) 主落点的覆盖项由映射层已发，这里不重发；
//  3) 预设已删 / 槽位没图 / 非参考图槽位 → 不产生计划项。
// 挂载节点自动接线（#4534）：作者没连线的槽位按序接到挂载节点的 image_0..N 口
// 上，同值覆盖项由这里补发；挂载口常在未暴露的张量口上（#4405 的候选口径），
// 解析按对象直取，不依赖暴露面。（#4547：追加端口已移除，扇出由挂载节点承担。）
import { describe, expect, it } from "vitest";

import {
  buildReferenceLoaderPlan,
  mountImagePortsForNodes,
  mountReferenceCapacityOf,
} from "./reference-loader-plan";
import type { ReferenceLoaderPreset } from "./reference-loader-preset";

const PRESET: ReferenceLoaderPreset = {
  id: "p1",
  name: "缩放对齐",
  steps: [{ class: "ResizeImageMaskNode" }],
};

/* 直接以字面量传入（结构匹配 WorkflowIOMap），不在 lib 测试里引视图层类型。 */
const IO = {
  "69::param::image_0": { nodeId: "69", name: "image_0", kind: "param", direction: "input" },
  "69::param::image_1": { nodeId: "69", name: "image_1", kind: "param", direction: "input" },
  "12::param::image": { nodeId: "12", name: "image", kind: "param", direction: "input" },
} as const;

describe("buildReferenceLoaderPlan", () => {
  it("主落点 + 预设进计划；覆盖项映射层已发，这里不重发", () => {
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: { "reference-image": { presetId: "p1" } },
      filenames: ["a.png"],
      io: IO,
      presets: [PRESET],
      resolved: { "reference-image": "69::param::image_0" },
    });
    expect(plan).toEqual({ "69::image_0": PRESET });
    expect(extraInputs).toEqual([]);
  });

  it("预设已删 / 槽位没图 / 非参考图槽位 → 不产生计划项", () => {
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: {
        "reference-image": { presetId: "gone" },
        "reference-image-2": { presetId: "p1" },
        prompt: { presetId: "p1" },
      },
      filenames: ["a.png"],
      io: IO,
      presets: [PRESET],
      resolved: {
        "reference-image": "69::param::image_0",
        "reference-image-2": "69::param::image_1",
        /* 非参考图槽位即使有落点也不得扇出（槽位判据回归）。 */
        prompt: "12::param::image",
      },
    });
    expect(plan).toEqual({});
    expect(extraInputs).toEqual([]);
  });

  it("主落点没连线且没有挂载口 → 不产生计划项（无落点可接）", () => {
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: { "reference-image": { presetId: "p1" } },
      filenames: ["a.png"],
      io: IO,
      presets: [PRESET],
      resolved: { "reference-image": null },
    });
    expect(plan).toEqual({});
    expect(extraInputs).toEqual([]);
  });
});

/* ── 参考图挂载节点：image_0..N 规律自动接线（ISSUE #4534） ────────────── */

describe("mountImagePortsForNodes", () => {
  const GRAPH_PORTS = [
    { ioKey: "69::param::images.image_0", label: "i0", name: "images.image_0", nodeId: "69" },
    { ioKey: "69::param::images.image_1", label: "i1", name: "images.image_1", nodeId: "69" },
    { ioKey: "69::param::images.image_2", label: "i2", name: "images.image_2", nodeId: "69" },
    { ioKey: "34::param::images.image1", label: "j1", name: "images.image1", nodeId: "34" },
    { ioKey: "12::param::image", label: "单数口", name: "image", nodeId: "12" },
    { ioKey: "99::param::images.image_0", label: "未挂载", name: "images.image_0", nodeId: "99" },
  ];

  it("只取挂载节点的 image_0..N 口，按数字后缀排序", () => {
    const ports = mountImagePortsForNodes({ graphImagePorts: GRAPH_PORTS, mountNodeIds: ["69"] });
    expect(ports.map((port) => port.ioKey)).toEqual([
      "69::param::images.image_0",
      "69::param::images.image_1",
      "69::param::images.image_2",
    ]);
  });

  it("单数口（image，无数字后缀）与非挂载节点不参与", () => {
    const ports = mountImagePortsForNodes({
      graphImagePorts: GRAPH_PORTS,
      mountNodeIds: ["12", "34"],
    });
    /* 34 的 image1 有数字后缀，参与；12 的单数口（image，无数字后缀）不是
     * 多参考图展开点，不参与。 */
    expect(ports.map((port) => port.ioKey)).toEqual(["34::param::images.image1"]);
  });

  it("没有挂载节点 → 空数组", () => {
    expect(mountImagePortsForNodes({ graphImagePorts: GRAPH_PORTS, mountNodeIds: [] })).toEqual([]);
    expect(mountImagePortsForNodes({ mountNodeIds: ["69"] })).toEqual([]);
  });
});

describe("buildReferenceLoaderPlan · 挂载节点自动接线（#4534）", () => {
  const MOUNT_PORTS = [
    { ioKey: "69::param::images.image_0", label: "i0", name: "images.image_0", nodeId: "69" },
    { ioKey: "69::param::images.image_1", label: "i1", name: "images.image_1", nodeId: "69" },
    { ioKey: "69::param::images.image_2", label: "i2", name: "images.image_2", nodeId: "69" },
  ];

  it("没绑定的槽位按序自动接到挂载节点的模式口上（覆盖项下发）", () => {
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: {},
      filenames: ["a.png", "b.png", "c.png"],
      /* 挂载口不在暴露面里：解析按对象直取，不依赖 io（#4405 口径）。 */
      io: IO,
      presets: [PRESET],
      resolved: {},
      mountPorts: MOUNT_PORTS,
    });
    expect(plan).toEqual({});
    expect(extraInputs).toEqual([
      { nodeId: "69", name: "images.image_0", value: "a.png" },
      { nodeId: "69", name: "images.image_1", value: "b.png" },
      { nodeId: "69", name: "images.image_2", value: "c.png" },
    ]);
  });

  it("作者连过线的槽位仍走原落点，其余槽位按序补位到挂载口", () => {
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: { "reference-image": { presetId: "p1" } },
      filenames: ["a.png", "b.png", "c.png"],
      io: IO,
      presets: [PRESET],
      resolved: { "reference-image": "69::param::image_0" },
      mountPorts: MOUNT_PORTS,
    });
    /* 槽位 0：作者连线 + 预设（原路径，映射层已发覆盖项，这里不重发）。 */
    expect(plan).toEqual({ "69::image_0": PRESET });
    /* 槽位 1 / 2：按序自动接到 image_1 / image_2。 */
    expect(extraInputs).toEqual([
      { nodeId: "69", name: "images.image_1", value: "b.png" },
      { nodeId: "69", name: "images.image_2", value: "c.png" },
    ]);
  });

  it("只有挂载节点、没有任何绑定时也构建计划（自动接线不依赖手动配置）", () => {
    const { extraInputs } = buildReferenceLoaderPlan({
      bindings: {},
      filenames: ["a.png"],
      io: IO,
      presets: [],
      resolved: {},
      mountPorts: MOUNT_PORTS.slice(0, 1),
    });
    expect(extraInputs).toEqual([{ nodeId: "69", name: "images.image_0", value: "a.png" }]);
  });

  it("槽位数超过挂载口数时，多出的槽位不落点（不越界补位）", () => {
    const { extraInputs } = buildReferenceLoaderPlan({
      bindings: {},
      filenames: ["a.png", "b.png"],
      io: IO,
      presets: [],
      resolved: {},
      mountPorts: MOUNT_PORTS.slice(0, 1),
    });
    expect(extraInputs).toEqual([{ nodeId: "69", name: "images.image_0", value: "a.png" }]);
  });
});

describe("多挂载节点按节点内序对齐（ISSUE #4856）", () => {
  /* #4856 现场：两棵挂载节点（69 = image_0..1 零基、34 = image1..2 一基），
   * 扁平清单按数字后缀排序后是 [69.image_0, 34.image1, 69.image_1, 34.image2]。
   * 此前按统一下标对齐：槽位 1 落到 34.image1（别的节点的第一个口）——
   * 交错错位。现在按节点内序对齐：槽位 i 喂到每棵节点的第 i 个口（同图多口）。 */
  const INTERLEAVED = [
    { ioKey: "69::param::images.image_0", label: "i0", name: "images.image_0", nodeId: "69" },
    { ioKey: "34::param::images.image1", label: "j1", name: "images.image1", nodeId: "34" },
    { ioKey: "69::param::images.image_1", label: "i1", name: "images.image_1", nodeId: "69" },
    { ioKey: "34::param::images.image2", label: "j2", name: "images.image2", nodeId: "34" },
  ];

  it("槽位按节点内序对齐，同一张图喂到每棵挂载节点的同序口", () => {
    const { extraInputs } = buildReferenceLoaderPlan({
      bindings: {},
      filenames: ["a.png", "b.png"],
      io: IO,
      presets: [],
      resolved: {},
      mountPorts: INTERLEAVED,
    });
    expect(extraInputs).toEqual([
      { nodeId: "69", name: "images.image_0", value: "a.png" },
      { nodeId: "34", name: "images.image1", value: "a.png" },
      { nodeId: "69", name: "images.image_1", value: "b.png" },
      { nodeId: "34", name: "images.image2", value: "b.png" },
    ]);
  });

  it("某棵节点没有对应序号的口时跳过该口（不越界补位）", () => {
    const { extraInputs } = buildReferenceLoaderPlan({
      bindings: {},
      filenames: ["a.png", "b.png", "c.png"],
      io: IO,
      presets: [],
      resolved: {},
      mountPorts: INTERLEAVED.slice(0, 2),
    });
    expect(extraInputs).toEqual([
      { nodeId: "69", name: "images.image_0", value: "a.png" },
      { nodeId: "34", name: "images.image1", value: "a.png" },
    ]);
  });
});

describe("mountReferenceCapacityOf（ISSUE #4856）", () => {
  it("取各挂载节点模式口数的最大值（一槽有一棵节点可落即算）", () => {
    expect(
      mountReferenceCapacityOf([
        { ioKey: "a", label: "", name: "images.image_0", nodeId: "69" },
        { ioKey: "b", label: "", name: "images.image_1", nodeId: "69" },
        { ioKey: "c", label: "", name: "images.image1", nodeId: "34" },
      ]),
    ).toBe(2);
    expect(mountReferenceCapacityOf([])).toBe(0);
  });
});
