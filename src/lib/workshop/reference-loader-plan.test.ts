// 参考图装载计划构造的契约（#4376）：
//  1) 槽位绑定（预设 + 追加端口）→「端点 → 预设」计划 + 追加端口的同值覆盖项；
//  2) 主落点的覆盖项由映射层已发，这里不重发；
//  3) 主落点没连线时，追加端口就是全部落点；
//  4) 预设已删 / 槽位没图 / 非参考图槽位 → 不产生计划项。
import { describe, expect, it } from "vitest";

import { buildReferenceLoaderPlan } from "./reference-loader-plan";
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
