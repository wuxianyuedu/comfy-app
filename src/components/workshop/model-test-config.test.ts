// ── model-test-config 纯函数单测（#3590；#3778 起含契约行与尺寸桥）────────
// 覆盖五件事：候选过滤、请求组装（数字解析与空键省略）、控件分派、
// 契约 → 统一输入行（必备标记与承接状态）、表单值 ⇄ 尺寸表达的桥。

import { describe, expect, it } from "vitest";

import {
  PROMPT_PRESETS,
  RELAY_INPUT_TYPES,
  assembleImageRequest,
  assembleVideoRequest,
  contractTestRows,
  controlForInputType,
  defaultModeForKind,
  defaultSizeValues,
  fallbackTestRows,
  modeTabsForKind,
  randomPromptFor,
  sizeSpecToValues,
  sizeValuesToSpec,
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

  it("seed（ISSUE #3778）：非负整数带上（0 合法）；空白 / 非数 / 负数不带", () => {
    expect(
      assembleImageRequest({ model: "m", mode: "T2I", values: { prompt: "p", seed: "42" } }),
    ).toMatchObject({ seed: 42 });
    expect(
      assembleImageRequest({ model: "m", mode: "T2I", values: { prompt: "p", seed: "0" } }),
    ).toMatchObject({ seed: 0 });
    for (const bad of ["", "abc", "-1", "1.5"]) {
      const req = assembleImageRequest({
        model: "m",
        mode: "T2I",
        values: { prompt: "p", seed: bad },
      });
      expect("seed" in req).toBe(false);
    }
  });

  it("seed（ISSUE #3783）：视频组装同口径承接，且通道承接集合列为真实承接", () => {
    expect(
      assembleVideoRequest({ model: "m", mode: "T2V", values: { prompt: "p", seed: "42" } }),
    ).toMatchObject({ seed: 42 });
    expect(
      assembleVideoRequest({ model: "m", mode: "T2V", values: { prompt: "p", seed: "0" } }),
    ).toMatchObject({ seed: 0 });
    for (const bad of ["", "abc", "-1", "1.5"]) {
      const req = assembleVideoRequest({
        model: "m",
        mode: "T2V",
        values: { prompt: "p", seed: bad },
      });
      expect("seed" in req).toBe(false);
    }
    /* 承接集合与 unifiedVideoInputs 互为镜像：seed 在集合里，测试页视频模式的
     * 种子口才从「未承接」禁用态变为可用输入（#3783 的验收点）。 */
    expect(RELAY_INPUT_TYPES.video).toContain("seed");
  });
});

describe("controlForInputType", () => {
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
});

describe("contractTestRows（ISSUE #3778：统一输入行来自模式契约）", () => {
  /* 与诉求单现场同形：T2I 配了 4 个参数，2 必填 2 可选。 */
  const contract = {
    inputs: ["prompt", "negative", "size", "seed"],
    required: ["prompt", "size"],
  };

  it("行清单 = 契约口顺序；必备标记随契约 required；seed 不再缺席", () => {
    const rows = contractTestRows(contract, "image");
    expect(rows.map((r) => r.id)).toEqual(["prompt", "negative", "size", "seed"]);
    expect(rows.map((r) => r.required)).toEqual([true, false, true, false]);
    const seed = rows.find((r) => r.id === "seed");
    expect(seed).toMatchObject({ control: "number", disabled: false, valueKey: "seed" });
  });

  it("size 复合口聚成一行（control=size）；视频通道不承接尺寸 → 禁用行", () => {
    const image = contractTestRows(contract, "image");
    expect(image.find((r) => r.id === "size")).toMatchObject({ control: "size", disabled: false });
    const video = contractTestRows(contract, "video");
    expect(video.find((r) => r.id === "size")).toMatchObject({ control: "size", disabled: true });
  });

  it("带序号参考图第 2 张起与自定义口：通道没有对应类型 → 未承接禁用行", () => {
    const rows = contractTestRows(
      {
        customInputs: [{ id: "custom-text-1", kind: "text", label: "画风" }],
        inputs: ["reference-image", "reference-image-2", "custom-text-1", "lora-name"],
        required: ["reference-image"],
      },
      "image",
    );
    expect(rows.find((r) => r.id === "reference-image")).toMatchObject({
      control: "image",
      disabled: false,
      required: true,
      valueKey: "image",
    });
    expect(rows.find((r) => r.id === "reference-image-2")).toMatchObject({
      disabled: true,
      valueKey: null,
    });
    expect(rows.find((r) => r.id === "custom-text-1")).toMatchObject({
      disabled: true,
      label: "画风",
    });
    /* lora 走 lora-model 类型，但生图通道不承接 → 禁用。 */
    expect(rows.find((r) => r.id === "lora-name")?.disabled).toBe(true);
  });

  it("契约读数未到 → 兜底行（通道承接集合；尺寸族聚一行；必备只认提示词）", () => {
    const rows = fallbackTestRows("image");
    expect(rows.some((r) => r.control === "size")).toBe(true);
    const prompt = rows.find((r) => r.valueKey === "prompt");
    expect(prompt).toMatchObject({ required: true, disabled: false });
    expect(rows.every((r) => !r.disabled)).toBe(true);
  });
});

describe("尺寸表单值 ⇄ SizeSpec 桥（ISSUE #3778 问题 4）", () => {
  it("分辨率档：resolution 直接作 clarity；比例吸附到预设 label", () => {
    const spec = sizeValuesToSpec({
      "aspect-ratio": "1:1",
      megapixels: "1",
      multiple: "64",
      resolution: "1k",
    });
    expect(spec.clarity).toBe("1k");
    expect(spec.ratio).toBe("1:1 正方");
    expect(spec.multiple).toBe(64);
  });

  it("百万像素档（含自由值）：megapixels → M 标签；全空回落默认", () => {
    expect(sizeValuesToSpec({ megapixels: "2.5" }).clarity).toBe("2.5M");
    expect(sizeValuesToSpec({}).clarity.length).toBeGreaterThan(0);
  });

  it("回写：分辨率档带档位名与换算值；百万像素档清空 resolution", () => {
    const fromRes = sizeSpecToValues(
      sizeValuesToSpec({ "aspect-ratio": "1:1", resolution: "2k" }),
      "image",
    );
    expect(fromRes.resolution).toBe("2k");
    expect(Number(fromRes.megapixels)).toBeGreaterThan(0);
    expect(fromRes["aspect-ratio"]).toBe("1:1");
    const fromMp = sizeSpecToValues(sizeValuesToSpec({ megapixels: "2.5" }), "image");
    expect(fromMp.resolution).toBe("");
    expect(fromMp.megapixels).toBe("2.5");
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

  it("随机提示词总落在常用样本表里", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(PROMPT_PRESETS).toContain(randomPromptFor());
    }
  });
});
