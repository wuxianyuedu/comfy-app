// 参考图装载计划构造的契约（#4376）：
//  1) 槽位绑定（预设 + 追加端口）→「端点 → 预设」计划 + 追加端口的同值覆盖项；
//  2) 主落点的覆盖项由映射层已发，这里不重发；
//  3) 主落点没连线时，追加端口就是全部落点；
//  4) 预设已删 / 槽位没图 / 非参考图槽位 → 不产生计划项。
import { describe, expect, it } from "vitest";

import { buildReferenceLoaderPlan, mountImagePortsForNodes } from "./reference-loader-plan";
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
  it("主落点 + 追加端口都进计划，追加端口补发同值覆盖项", () => {
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: {
        "reference-image": { presetId: "p1", extraTargets: ["12::param::image"] },
      },
      filenames: ["a.png"],
      io: IO,
      presets: [PRESET],
      resolved: { "reference-image": "69::param::image_0" },
    });
    expect(plan).toEqual({
      "69::image_0": PRESET,
      "12::image": PRESET,
    });
    /* 主落点的覆盖项映射层已发；追加端口在这里补发。 */
    expect(extraInputs).toEqual([{ nodeId: "12", name: "image", value: "a.png" }]);
  });

  it("主落点没连线时，追加端口就是全部落点", () => {
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: {
        "reference-image": { presetId: "p1", extraTargets: ["12::param::image"] },
      },
      filenames: ["a.png"],
      io: IO,
      presets: [PRESET],
      resolved: { "reference-image": null },
    });
    expect(plan).toEqual({ "12::image": PRESET });
    expect(extraInputs).toEqual([{ nodeId: "12", name: "image", value: "a.png" }]);
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

  it("只加追加端口、不绑预设 → 仍补发扇出覆盖项（裸 LoadImage 也扇出）", () => {
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: { "reference-image": { extraTargets: ["12::param::image"] } },
      filenames: ["a.png"],
      io: IO,
      presets: [PRESET],
      resolved: { "reference-image": "69::param::image_0" },
    });
    expect(plan).toEqual({});
    expect(extraInputs).toEqual([{ nodeId: "12", name: "image", value: "a.png" }]);
  });
});

describe("buildReferenceLoaderPlan · 未暴露张量口（#4405）", () => {
  it("追加端口落在未暴露的图片族连线上时，经 graphImagePorts 解析 nodeId/name", () => {
    /* MiniMax 现场：暴露面里只有 LoadImage 的 upload 部件口，
     * images.image_1 / images.image2 都是没勾选暴露的张量口。 */
    const { plan, extraInputs } = buildReferenceLoaderPlan({
      bindings: {
        "reference-image": {
          presetId: "p1",
          extraTargets: ["69::param::images.image_1", "34::param::images.image2"],
        },
      },
      filenames: ["a.png"],
      io: {
        "45::widget::upload": { nodeId: "45", name: "upload", kind: "widget", direction: "input" },
      },
      presets: [PRESET],
      resolved: { "reference-image": "45::widget::upload" },
      graphImagePorts: [
        {
          ioKey: "69::param::images.image_1",
          label: "images.image_1（69）",
          name: "images.image_1",
          nodeId: "69",
        },
        {
          ioKey: "34::param::images.image2",
          label: "images.image2（34）",
          name: "images.image2",
          nodeId: "34",
        },
      ],
    });
    expect(plan).toEqual({
      "45::upload": PRESET,
      "69::images.image_1": PRESET,
      "34::images.image2": PRESET,
    });
    /* 主落点（45::widget::upload）不重发；两个追加端口各补一份同值覆盖项。 */
    expect(extraInputs).toEqual([
      { nodeId: "69", name: "images.image_1", value: "a.png" },
      { nodeId: "34", name: "images.image2", value: "a.png" },
    ]);
  });

  it("暴露面与全图候选同键时以暴露面为准（不重复发覆盖项）", () => {
    const { extraInputs } = buildReferenceLoaderPlan({
      bindings: { "reference-image": { extraTargets: ["69::param::image_1"] } },
      filenames: ["a.png"],
      io: {
        "69::param::image_1": { nodeId: "69", name: "image_1", kind: "param", direction: "input" },
      },
      presets: [PRESET],
      resolved: { "reference-image": "69::param::image_0" },
      graphImagePorts: [
        { ioKey: "69::param::image_1", label: "image_1（69）", name: "image_1", nodeId: "69" },
      ],
    });
    expect(extraInputs).toEqual([{ nodeId: "69", name: "image_1", value: "a.png" }]);
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
      io: IO,
      presets: [PRESET],
      resolved: {},
      graphImagePorts: MOUNT_PORTS,
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
      graphImagePorts: MOUNT_PORTS,
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
      graphImagePorts: MOUNT_PORTS.slice(0, 1),
      mountPorts: MOUNT_PORTS.slice(0, 1),
    });
    expect(extraInputs).toEqual([{ nodeId: "69", name: "images.image_0", value: "a.png" }]);
  });
});
