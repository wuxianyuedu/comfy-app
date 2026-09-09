import { describe, it, expect } from "vitest";
import { applyRawOverrides } from "./raw-overrides";

/**
 * Subgraph wrapper（liblib raw UI-format）：暴露了内层 KSampler 的 seed，
 * 但没暴露它的随机化控制。ComfyUI 会把该 control_after_generate 隔离进
 * `proxyWidgetErrorQuarantine`，因此 wrapper 的 `widgets_values` 里 seed
 * 之后**没有**哨兵槽。此时用户在前端把 seed 切成「随机值」时下发的
 * `control_after_generate=randomize` 覆盖项必须能兜底生效。
 */
const subgraphWrapperNode = {
  id: 76,
  type: "9b9009e4-2d3d-445f-9be5-6063f465757e",
  // 10 个 widget 输入，widgets_values 长度也是 10 → 无 control 哨兵槽
  inputs: [
    { name: "text", widget: { name: "text" } },
    { name: "text_1", widget: { name: "text_1" } },
    { name: "width_1", widget: { name: "width_1" } },
    { name: "height_1", widget: { name: "height_1" } },
    { name: "steps_1", widget: { name: "steps_1" } },
    { name: "cfg_1", widget: { name: "cfg_1" } },
    { name: "seed", widget: { name: "seed" } },
    { name: "unet_name_1", widget: { name: "unet_name_1" } },
    { name: "clip_name_1", widget: { name: "clip_name_1" } },
    { name: "vae_name_1", widget: { name: "vae_name_1" } },
  ],
  widgets_values: [
    "1244",
    "no realistic proportions",
    1024,
    1024,
    25,
    4,
    276260017540259, // seed 值（固定）
    "z_image_int8_convrot.safetensors",
    "qwen_3_4b.safetensors",
    "ae.safetensors",
  ],
};

function rawJsonWith(node: unknown) {
  return { nodes: [node], links: [] };
}

describe("applyRawOverrides — control_after_generate=randomize 的哨兵槽回退", () => {
  it("子图 wrapper 无 control 哨兵槽时，randomize 应兜底刷新 seed 值", () => {
    const raw = rawJsonWith(JSON.parse(JSON.stringify(subgraphWrapperNode)));
    const result = applyRawOverrides(raw, [
      { nodeId: "76", name: "control_after_generate", value: "randomize" },
    ]) as { nodes: { id: number; widgets_values: unknown[] }[] };

    const node = result.nodes.find((n) => n.id === 76)!;
    const seed = node.widgets_values[6];
    // seed 已被刷新为随机值，而不是固定的 276260017540259
    expect(seed).not.toBe(276260017540259);
    expect(typeof seed).toBe("number");
    expect(seed).toBeGreaterThanOrEqual(0);
    // 随机值只覆盖 seed 槽，不破坏后续依赖 seed 哨兵槽的槽位
    expect(node.widgets_values[7]).toBe("z_image_int8_convrot.safetensors");
    expect(node.widgets_values[9]).toBe("ae.safetensors");
  });

  it("有 control 哨兵槽的普通节点仍写入 seedSlot+1（不触发回退）", () => {
    // KSampler 有 6 个 widget 输入 + 7 个 widgets_values → 有哨兵槽
    const ksampler = {
      id: 69,
      type: "KSampler",
      inputs: [
        { name: "model", type: "MODEL" },
        { name: "positive", type: "CONDITIONING" },
        { name: "negative", type: "CONDITIONING" },
        { name: "latent_image", type: "LATENT" },
        { name: "seed", widget: { name: "seed" } },
        { name: "steps", widget: { name: "steps" } },
        { name: "cfg", widget: { name: "cfg" } },
        { name: "sampler_name", widget: { name: "sampler_name" } },
        { name: "scheduler", widget: { name: "scheduler" } },
        { name: "denoise", widget: { name: "denoise" } },
      ],
      widgets_values: [
        276260017540259,
        "fixed",
        25,
        4,
        "res_multistep",
        "simple",
        1,
      ],
    };
    const raw = rawJsonWith(JSON.parse(JSON.stringify(ksampler)));
    const result = applyRawOverrides(raw, [
      { nodeId: "69", name: "control_after_generate", value: "randomize" },
    ]) as { nodes: { id: number; widgets_values: unknown[] }[] };

    const node = result.nodes.find((n) => n.id === 69)!;
    // 有哨兵槽 → 写入 seedSlot+1（随机化模式），seed 值保持不变
    expect(node.widgets_values[1]).toBe("randomize");
    expect(node.widgets_values[0]).toBe(276260017540259);
  });

  it("非 randomize 且无哨兵槽时保持原值（不误改 seed）", () => {
    const raw = rawJsonWith(JSON.parse(JSON.stringify(subgraphWrapperNode)));
    const result = applyRawOverrides(raw, [
      { nodeId: "76", name: "control_after_generate", value: "fixed" },
    ]) as { nodes: { id: number; widgets_values: unknown[] }[] };

    const node = result.nodes.find((n) => n.id === 76)!;
    expect(node.widgets_values[6]).toBe(276260017540259);
  });

  it("没有 seed widget 的节点跳过，不报错", () => {
    const note = {
      id: 35,
      type: "MarkdownNote",
      inputs: [],
      widgets_values: ["hello"],
    };
    const raw = rawJsonWith(JSON.parse(JSON.stringify(note)));
    const result = applyRawOverrides(raw, [
      { nodeId: "35", name: "control_after_generate", value: "randomize" },
    ]);
    const node = (
      result as { nodes: { id: number; widgets_values: unknown[] }[] }
    ).nodes[0]!;
    expect(node.widgets_values).toEqual(["hello"]);
  });
});
