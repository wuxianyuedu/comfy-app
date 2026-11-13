// ── model-test-config 纯函数单测（#3590）─────────────────────────────────
// 覆盖三件事：候选过滤、请求组装（数字解析与空键省略）、控件分派。

import { describe, expect, it } from "vitest";

import type { RemoteModeAdapter } from "~/lib/workshop/remote-model-adapter";

import {
  PROMPT_PRESETS,
  assembleImageRequest,
  assembleVideoRequest,
  clarityOptionsFor,
  controlForInputType,
  defaultModeForKind,
  defaultSizeValues,
  modeTabsForKind,
  randomPromptFor,
  relayInputCount,
  testCandidatesForKind,
} from "./model-test-config";

describe("testCandidatesForKind", () => {
  const entries = [
    { baseUrl: "https://a/v1", kind: "image", name: "agnes-image" },
    { baseUrl: "https://a/v1", kind: "video", name: "agnes-video" },
    { baseUrl: "https://a/v1", kind: "chat", name: "agnes-3.0" },
    { baseUrl: null, kind: "image", name: "无址条目" },
  ];

  it("按 kind 过滤；chat 不参与；无名条目丢弃", () => {
    expect(testCandidatesForKind("image", entries).map((c) => c.name)).toEqual(["agnes-image"]);
    expect(testCandidatesForKind("video", entries).map((c) => c.name)).toEqual(["agnes-video"]);
  });
});

describe("assembleImageRequest / assembleVideoRequest", () => {
  it("填了的键带上、没填的键省略；multiple / duration 转数字", () => {
    expect(
      assembleImageRequest({
        model: "agnes-image",
        mode: "T2I",
        values: { prompt: " 一只柴犬 ", negative: " 模糊 ", "aspect-ratio": "16:9" },
      }),
    ).toEqual({
      model: "agnes-image",
      mode: "T2I",
      prompt: "一只柴犬",
      negative: "模糊",
      aspectRatio: "16:9",
    });
    expect(
      assembleVideoRequest({
        model: "agnes-video",
        mode: "T2V",
        values: { prompt: "p", duration: "5", "first-frame": "data:image/png;base64,AAA" },
      }),
    ).toEqual({
      model: "agnes-video",
      mode: "T2V",
      prompt: "p",
      duration: 5,
      image: "data:image/png;base64,AAA",
    });
  });

  it("非法数字（空白 / 非数 / 非正）不带键", () => {
    const req = assembleImageRequest({
      model: "m",
      mode: "T2I",
      values: { prompt: "p", multiple: " abc " },
    });
    expect("multiple" in req).toBe(false);
    const req2 = assembleVideoRequest({
      model: "m",
      mode: "T2V",
      values: { prompt: "p", duration: "-3" },
    });
    expect("duration" in req2).toBe(false);
  });
});

describe("controlForInputType / relayInputCount", () => {
  it("17 种输入类型都有控件；图片族归 image、尺寸三件套各归各位", () => {
    expect(controlForInputType("prompt")).toBe("prompt");
    expect(controlForInputType("negative")).toBe("negative");
    expect(controlForInputType("aspect-ratio")).toBe("ratio");
    expect(controlForInputType("megapixels")).toBe("megapixels");
    expect(controlForInputType("multiple")).toBe("multiple");
    expect(controlForInputType("duration")).toBe("duration");
    expect(controlForInputType("seed")).toBe("number");
    for (const t of [
      "image",
      "first-frame",
      "last-frame",
      "mask",
      "depth",
      "pose",
      "lineart",
      "edge",
    ] as const) {
      expect(controlForInputType(t)).toBe("image");
    }
  });

  it("relayInputCount 只数通道承接得住的行（其余是工坊完整链路的输入）", () => {
    const adapter: RemoteModeAdapter = {
      mode: "T2I",
      inputs: [
        { type: "prompt", field: "prompt" },
        { type: "seed", field: "seed" },
      ],
      outputField: "url",
    };
    expect(relayInputCount(adapter, "image")).toBe(1);
    /* prompt 也在视频承接集里，seed 不在 */
    expect(relayInputCount(adapter, "video")).toBe(1);
  });
});

describe("modeTabsForKind / defaultModeForKind", () => {
  const adaptersByModel = {
    "agnes-image": [{ mode: "T2I" }, { mode: "I2I" }],
    "agnes-image-2": [{ mode: "T2I" }],
  };

  it("列出该用途下全部生成类模式；徽标数 = 配了该模式适配器的候选数", () => {
    const tabs = modeTabsForKind("image", adaptersByModel);
    /* 图片侧生成类模式的第一个与最后一个都在列（全部生成类，含 0 配置的） */
    const t2i = tabs.find((t) => t.mode === "T2I");
    const i2i = tabs.find((t) => t.mode === "I2I");
    expect(t2i).toMatchObject({ label: "文生图", modelCount: 2 });
    expect(i2i).toMatchObject({ label: "图生图", modelCount: 1 });
    /* 生成类（isGenerative）之外的后处理模式不进页签 */
    expect(tabs.some((t) => t.mode === "Upscale")).toBe(false);
    /* 没有候选配适配器的模式也在列，计数为 0 */
    expect(tabs.every((t) => typeof t.modelCount === "number")).toBe(true);
  });

  it("视频用途只列视频侧模式；空适配器索引全为 0", () => {
    const tabs = modeTabsForKind("video", {});
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.some((t) => t.mode === "T2V")).toBe(true);
    expect(tabs.some((t) => t.mode === "T2I")).toBe(false);
    expect(tabs.every((t) => t.modelCount === 0)).toBe(true);
  });

  it("默认模式 = 该用途的第一个生成类类型码", () => {
    expect(defaultModeForKind("image")).toBe("T2I");
    expect(defaultModeForKind("video")).toBe("T2V");
  });
});

describe("尺寸默认档与像素候选（ISSUE #3742）", () => {
  it("图片模式预置最常用档：1:1 + 1k（换算值随 megapixels、对齐倍数随 multiple）", () => {
    const image = defaultSizeValues("T2I");
    expect(image["aspect-ratio"]).toBe("1:1");
    expect(image.resolution).toBe("1k");
    expect(image.megapixels).toMatch(/^\d+(?:\.\d+)?$/);
    expect(image.multiple).toMatch(/^\d+$/);
    /* 视频模式的 API 通道不承接尺寸 ⇒ 不给默认。 */
    expect(defaultSizeValues("T2V")).toEqual({});
  });

  it("像素候选：分辨率档带档位名与换算值；百万像素档不带 resolution", () => {
    const rows = clarityOptionsFor("image", 1);
    const res2k = rows.find((r) => r.label === "2K");
    expect(res2k?.subgroup).toBe("resolution");
    expect(res2k?.resolution).toBe("2k");
    expect(Number(res2k?.megapixels)).toBeGreaterThan(0);
    expect(Number(res2k?.multiple)).toBeGreaterThan(0);
    const mega2 = rows.find((r) => r.label === "2M");
    expect(mega2?.megapixels).toBe("2");
    expect(mega2?.resolution).toBe("");
    expect(mega2?.multiple).toBe("");
  });

  it("随机提示词总落在常用样本表里", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(PROMPT_PRESETS).toContain(randomPromptFor());
    }
  });
});
