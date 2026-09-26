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

/* ─────────────────────────────────────────────────────────────────────────
 * 子图 wrapper 的覆盖必须同步到内层节点（ISSUE #267）
 *
 * 现象：提示词/种子在 UI 上下发了，comfy-cli 也正常提交，但每次生成的都是
 * 工作流里存的那一张图（与提示词无关）。根因：comfy-cli 把子图展开成
 * `wrapperId:innerId` 后，读的是**内层节点**的 `widgets_values`；wrapper 上
 * 的 `widgets_values` 只是宿主值，只有较新的 comfy-cli（≥ 1.20 的
 * promoted-widget 回写）才会把它应用回去。只写 wrapper 不写内层，覆盖在
 * 转换阶段被内层默认值整段盖掉。
 * ───────────────────────────────────────────────────────────────────────── */

/** 真实 liblib 子图模板的最小复刻：wrapper 76（UUID class_type）+ 内层
 *  KSampler 69 / CLIPTextEncode 67，边界连线从哨兵节点 -10 出发。 */
function liblibSubgraphFixture() {
  return {
    nodes: [
      {
        id: 76,
        type: "9b9009e4-2d3d-445f-9be5-6063f465757e",
        inputs: [
          { name: "text", type: "STRING", widget: { name: "text" } },
          { name: "text_1", type: "STRING", widget: { name: "text_1" } },
          { name: "width_1", type: "INT", widget: { name: "width_1" } },
          { name: "height_1", type: "INT", widget: { name: "height_1" } },
          { name: "steps_1", type: "INT", widget: { name: "steps_1" } },
          { name: "cfg_1", type: "FLOAT", widget: { name: "cfg_1" } },
          { name: "seed", type: "INT", widget: { name: "seed" } },
          {
            name: "unet_name_1",
            type: "COMBO",
            widget: { name: "unet_name_1" },
          },
          {
            name: "clip_name_1",
            type: "COMBO",
            widget: { name: "clip_name_1" },
          },
          { name: "vae_name_1", type: "COMBO", widget: { name: "vae_name_1" } },
        ],
        widgets_values: [
          "旧提示词（工作流里存的）",
          "negative",
          1024,
          1024,
          25,
          4,
          276260017540259,
          "z_image_int8_convrot.safetensors",
          "qwen_3_4b.safetensors",
          "ae.safetensors",
        ],
        properties: {
          proxyWidgetErrorQuarantine: [
            {
              originalEntry: ["69", "control_after_generate"],
              reason: "missingSubgraphInput",
            },
          ],
        },
      },
    ],
    links: [],
    definitions: {
      subgraphs: [
        {
          id: "9b9009e4-2d3d-445f-9be5-6063f465757e",
          name: "Text to Image",
          inputs: [
            { id: "p1", name: "text", type: "STRING", linkIds: [108] },
            { id: "p2", name: "text_1", type: "STRING", linkIds: [125] },
            { id: "p3", name: "width_1", type: "INT", linkIds: [126] },
            { id: "p4", name: "height_1", type: "INT", linkIds: [127] },
            { id: "p5", name: "steps_1", type: "INT", linkIds: [128] },
            { id: "p6", name: "cfg_1", type: "FLOAT", linkIds: [129] },
            { id: "p7", name: "seed", type: "INT", linkIds: [130] },
            { id: "p8", name: "unet_name_1", type: "COMBO", linkIds: [131] },
            { id: "p9", name: "clip_name_1", type: "COMBO", linkIds: [132] },
            { id: "p10", name: "vae_name_1", type: "COMBO", linkIds: [133] },
          ],
          outputs: [{ id: "o1", name: "IMAGE", type: "IMAGE", linkIds: [79] }],
          nodes: [
            {
              id: 67,
              type: "CLIPTextEncode",
              inputs: [
                { name: "clip", type: "CLIP", link: 78 },
                {
                  name: "text",
                  type: "STRING",
                  widget: { name: "text" },
                  link: 108,
                },
              ],
              widgets_values: ["旧提示词（工作流里存的）"],
            },
            {
              id: 69,
              type: "KSampler",
              inputs: [
                { name: "model", type: "MODEL", link: 74 },
                { name: "positive", type: "CONDITIONING", link: 75 },
                { name: "negative", type: "CONDITIONING", link: 83 },
                { name: "latent_image", type: "LATENT", link: 145 },
                {
                  name: "seed",
                  type: "INT",
                  widget: { name: "seed" },
                  link: 130,
                },
                {
                  name: "steps",
                  type: "INT",
                  widget: { name: "steps" },
                  link: 128,
                },
                {
                  name: "cfg",
                  type: "FLOAT",
                  widget: { name: "cfg" },
                  link: 129,
                },
                {
                  name: "sampler_name",
                  type: "COMBO",
                  widget: { name: "sampler_name" },
                  link: null,
                },
                {
                  name: "scheduler",
                  type: "COMBO",
                  widget: { name: "scheduler" },
                  link: null,
                },
                {
                  name: "denoise",
                  type: "FLOAT",
                  widget: { name: "denoise" },
                  link: null,
                },
              ],
              widgets_values: [
                276260017540259,
                "randomize",
                25,
                4,
                "res_multistep",
                "simple",
                1,
              ],
            },
          ],
          links: [
            {
              id: 108,
              origin_id: -10,
              origin_slot: 0,
              target_id: 67,
              target_slot: 1,
              type: "STRING",
            },
            {
              id: 130,
              origin_id: -10,
              origin_slot: 6,
              target_id: 69,
              target_slot: 4,
              type: "INT",
            },
            {
              id: 145,
              origin_id: 68,
              origin_slot: 0,
              target_id: 69,
              target_slot: 3,
              type: "LATENT",
            },
          ],
        },
      ],
    },
  };
}

type FixtureResult = {
  nodes: { id: number; widgets_values: unknown[] }[];
  definitions: {
    subgraphs: {
      nodes: { id: number; widgets_values: unknown[] }[];
    }[];
  };
};

describe("applyRawOverrides — 子图 wrapper 覆盖同步到内层节点", () => {
  it("提示词覆盖要写进内层 CLIPTextEncode（宿主数组随后被漂移中和清空）", () => {
    const raw = applyRawOverrides(liblibSubgraphFixture(), [
      { nodeId: "76", name: "text", value: "3只小猫在喝山泉" },
    ]) as unknown as FixtureResult;

    const wrapper = raw.nodes.find((n) => n.id === 76)!;
    const inner = raw.definitions.subgraphs[0]!.nodes.find((n) => n.id === 67)!;
    // 关键断言：内层节点的值必须同步，否则 comfy-cli 展开子图后仍用旧提示词。
    expect(inner.widgets_values[0]).toBe("3只小猫在喝山泉");
    /* 宿主（wrapper）数组在 `neutralizePromotedHostDrift` 里被就地清空：
     * comfy-cli 读的是内层，宿主值已折进内层，清掉是为了避开提升控件的槽位
     * 漂移回写。所以这里断言的是「已中和」，不是「宿主仍保留覆盖值」。 */
    expect(wrapper.widgets_values.length).toBe(0);
  });

  it("seed 覆盖要写进内层 KSampler 的 seed 槽（跳过 control 哨兵）", () => {
    const raw = applyRawOverrides(liblibSubgraphFixture(), [
      { nodeId: "76", name: "seed", value: 12345 },
    ]) as unknown as FixtureResult;

    const inner = raw.definitions.subgraphs[0]!.nodes.find((n) => n.id === 69)!;
    // KSampler 的 widgets_values 依次是：seed、control、steps、cfg、sampler、scheduler、denoise
    expect(inner.widgets_values[0]).toBe(12345);
    // 哨兵槽与后续控件不能被写坏
    expect(inner.widgets_values[1]).toBe("randomize");
    expect(inner.widgets_values[2]).toBe(25);
    expect(inner.widgets_values[4]).toBe("res_multistep");
  });

  it("randomize 兜底生成的随机种子同样要落到内层 KSampler", () => {
    const raw = applyRawOverrides(liblibSubgraphFixture(), [
      { nodeId: "76", name: "control_after_generate", value: "randomize" },
    ]) as unknown as FixtureResult;

    const wrapper = raw.nodes.find((n) => n.id === 76)!;
    const inner = raw.definitions.subgraphs[0]!.nodes.find((n) => n.id === 69)!;
    /* minted 随机种子先写进 wrapper 的 seed 槽、再折进内层 KSampler 的 seed 槽，
     * 随后 `neutralizePromotedHostDrift` 清空宿主数组。comfy-cli 读内层，所以
     * 断言内层拿到新种子、宿主已被中和。 */
    const minted = inner.widgets_values[0];
    expect(typeof minted).toBe("number");
    expect(minted).not.toBe(276260017540259);
    expect(wrapper.widgets_values.length).toBe(0);
  });

  it("非子图节点不受影响（顶层普通节点仍只改自己）", () => {
    const raw = applyRawOverrides(
      {
        nodes: [
          {
            id: 5,
            type: "CLIPTextEncode",
            inputs: [
              { name: "clip", type: "CLIP", link: 1 },
              {
                name: "text",
                type: "STRING",
                widget: { name: "text" },
                link: null,
              },
            ],
            widgets_values: ["old"],
          },
        ],
        links: [],
      },
      [{ nodeId: "5", name: "text", value: "new" }],
    ) as { nodes: { id: number; widgets_values: unknown[] }[] };
    expect(raw.nodes[0]!.widgets_values[0]).toBe("new");
  });
});

/** `configureExecutorCli` 的接缝 smoke（P3 §5 第 1 期·第三步·执行批）。
 *  本文件其余用例只测 `applyRawOverrides` 纯逻辑、不加载 executor-cli 本体；
 *  这里用 dynamic import 只在需要时把 executor-cli 拽进来，避免给上面十几条
 *  静态测试加加载成本。兼作 `configureExecutorCli` 在 `check-dead-exports`
 *  眼里的消费方（同目录 `.test.ts` 算数，见 `TEST_CONSUMER_EXT`）。 */
describe("configureExecutorCli 接缝", () => {
  it("接受 Partial<ExecutorCliDeps> 且不抛", async () => {
    const mod = await import("./executor-cli");
    expect(() =>
      mod.configureExecutorCli({
        logger: { warn: () => undefined },
      }),
    ).not.toThrow();
    expect(() =>
      mod.configureExecutorCli({
        resolveComfyBase: async () => "http://127.0.0.1:8188",
      }),
    ).not.toThrow();
  });
});
