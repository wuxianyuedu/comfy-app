// findSeedWidgetNodeIds —— 从 rawJson 顶层 nodes[] 扫出带 seed 控件的节点 id（抽卡注种子的定位）。
import { describe, expect, it } from "vitest";

import { findSeedWidgetNodeIds } from "./raw";

describe("findSeedWidgetNodeIds", () => {
  it("命中带 seed / noise_seed 控件的节点，忽略无 seed 的节点", () => {
    const raw = {
      nodes: [
        {
          id: 9,
          type: "KSampler",
          inputs: [{ name: "seed", widget: { name: "seed" } }],
        },
        {
          id: 12,
          type: "KSamplerAdvanced",
          inputs: [{ name: "noise_seed", widget: { name: "noise_seed" } }],
        },
        {
          id: 3,
          type: "CheckpointLoaderSimple",
          inputs: [{ name: "ckpt_name", widget: { name: "ckpt_name" } }],
        },
      ],
    };
    expect(findSeedWidgetNodeIds(raw).sort()).toEqual(["12", "9"]);
  });

  it("widget 名缺省时回退用 input.name 判定；大小写不敏感", () => {
    const raw = {
      nodes: [
        { id: "7", inputs: [{ name: "Seed", widget: {} }] },
        { id: "8", inputs: [{ widget: { name: "NOISE_SEED" } }] },
      ],
    };
    expect(findSeedWidgetNodeIds(raw).sort()).toEqual(["7", "8"]);
  });

  it("非控件输入（无 widget）不算 seed 节点；字符串 id 也归一成 string", () => {
    const raw = {
      nodes: [
        { id: 5, inputs: [{ name: "seed" }] }, // 没有 widget → 不算
        { id: "6", inputs: [{ name: "seed", widget: { name: "seed" } }] },
      ],
    };
    expect(findSeedWidgetNodeIds(raw)).toEqual(["6"]);
  });

  it("非对象 / 无 nodes / nodes 非数组 → 空数组，不抛", () => {
    expect(findSeedWidgetNodeIds(null)).toEqual([]);
    expect(findSeedWidgetNodeIds("x")).toEqual([]);
    expect(findSeedWidgetNodeIds({})).toEqual([]);
    expect(findSeedWidgetNodeIds({ nodes: "no" })).toEqual([]);
  });
});
