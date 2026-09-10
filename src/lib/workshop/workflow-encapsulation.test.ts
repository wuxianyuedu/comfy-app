import { describe, it, expect } from "vitest";
import {
  buildEncapsulatedInputs,
  classifyVideoPin,
  classifyWorkshopPin,
  isVideoMode,
  modeUsesFirstFrame,
  modeUsesLastFrame,
  parseSizeParam,
  type WorkshopPinClass,
} from "./workflow-encapsulation";
import type { WorkflowIOEntry, WorkflowIOMap } from "~/lib/workflow-io-types";

/* ── 测试夹具 ─────────────────────────────────────────────── */

/** 一个典型的自定义工作流 IO：提示词 + 负向 + 尺寸对 + 若干内部参数。 */
const IO: WorkflowIOMap = {
  text: {
    direction: "input",
    kind: "widget",
    nodeId: "6",
    name: "text",
    label: "positive_prompt",
    type: "STRING",
    multiline: true,
    defaultValue: "a cat",
  },
  negative: {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "text",
    label: "negative_prompt",
    type: "STRING",
    multiline: true,
    defaultValue: "blurry",
  },
  width: {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "width",
    type: "INT",
    defaultValue: 512,
  },
  height: {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "height",
    type: "INT",
    defaultValue: 768,
  },
  steps: {
    direction: "input",
    kind: "widget",
    nodeId: "3",
    name: "steps",
    type: "INT",
    defaultValue: 28,
  },
  seed: {
    direction: "input",
    kind: "widget",
    nodeId: "3",
    name: "seed",
    type: "INT",
    defaultValue: 42,
  },
  initImage: {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    name: "image",
    type: "IMAGEUPLOAD",
    defaultValue: "",
  },
  model: {
    direction: "input",
    kind: "param",
    nodeId: "4",
    name: "model",
    type: "MODEL",
  },
  out: {
    direction: "output",
    kind: "output",
    nodeId: "10",
    name: "IMAGE",
  },
};

/** 取 workflowInputs 里的某个 name 的值。 */
function valueOf(inputs: { name: string; value: unknown }[], name: string): unknown {
  return inputs.find((i) => i.name === name)?.value;
}

/* ── classifyWorkshopPin ─────────────────────────────────── */

describe("classifyWorkshopPin", () => {
  const cases: [string, WorkflowIOEntry, WorkshopPinClass][] = [
    [
      "正面提示词 → prompt",
      { direction: "input", kind: "widget", nodeId: "1", name: "positive_prompt" },
      "prompt",
    ],
    [
      "负向提示词优先于正向",
      { direction: "input", kind: "widget", nodeId: "1", name: "negative_prompt" },
      "negative",
    ],
    [
      "宽 → size-width",
      { direction: "input", kind: "widget", nodeId: "1", name: "width" },
      "size-width",
    ],
    [
      "高 → size-height",
      { direction: "input", kind: "widget", nodeId: "1", name: "height" },
      "size-height",
    ],
    [
      "宽高比 → size-aspect",
      { direction: "input", kind: "widget", nodeId: "1", name: "aspect_ratio" },
      "size-aspect",
    ],
    [
      "百万像素 → size-megapixels",
      { direction: "input", kind: "widget", nodeId: "1", name: "megapixels" },
      "size-megapixels",
    ],
    [
      "IMAGEUPLOAD → reference-image",
      { direction: "input", kind: "widget", nodeId: "1", name: "image", type: "IMAGEUPLOAD" },
      "reference-image",
    ],
    [
      "steps → internal",
      { direction: "input", kind: "widget", nodeId: "1", name: "steps", type: "INT" },
      "internal",
    ],
    [
      "内部参数 cfg → internal",
      { direction: "input", kind: "widget", nodeId: "1", name: "cfg", type: "FLOAT" },
      "internal",
    ],
    [
      "连线端口 MODEL → internal",
      { direction: "input", kind: "param", nodeId: "1", name: "model", type: "MODEL" },
      "internal",
    ],
    [
      "输出 → internal",
      { direction: "output", kind: "output", nodeId: "1", name: "IMAGE" },
      "internal",
    ],
    [
      "无类型但默认值很长的文本 → prompt",
      {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "weird",
        type: "STRING",
        defaultValue: "x".repeat(60),
      },
      "prompt",
    ],
  ];
  it.each(cases)("%s", (_label, entry, expected) => {
    expect(classifyWorkshopPin(entry)).toBe(expected);
  });

  it("宽度判定优先于提示词启发式（避免泛化文本抢走尺寸口）", () => {
    expect(
      classifyWorkshopPin({
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "width_prompt_hint",
        type: "INT",
        defaultValue: 512,
      })
    ).toBe("size-width");
  });
});

/* ── 视频侧：模式判定 ─────────────────────────────────────── */

describe("视频模式判定", () => {
  it("视频模式码前缀命中，图类模式码不命中", () => {
    for (const code of ["T2V", "I2V", "TI2V", "FLF2V", "FL2V", "S2V", "V2V"]) {
      expect(isVideoMode(code)).toBe(true);
    }
    for (const code of ["T2I", "I2I", "Inpaint", "Upscale", "", null, undefined]) {
      expect(isVideoMode(code)).toBe(false);
    }
  });

  it("自带首帧的模式只有 I2V 家族", () => {
    for (const code of ["I2V", "ti2v", "FLF2V", "S2V"]) {
      expect(modeUsesFirstFrame(code)).toBe(true);
    }
    expect(modeUsesFirstFrame("T2V")).toBe(false);
    expect(modeUsesFirstFrame(null)).toBe(false);
  });

  it("需要尾帧的只有首尾帧家族", () => {
    expect(modeUsesLastFrame("FLF2V")).toBe(true);
    expect(modeUsesLastFrame("FMF2V")).toBe(true);
    expect(modeUsesLastFrame("I2V")).toBe(false);
  });
});

/* ── classifyVideoPin ────────────────────────────────────── */

describe("classifyVideoPin", () => {
  const pin = (over: Partial<WorkflowIOEntry>): WorkflowIOEntry => ({
    direction: "input",
    kind: "widget",
    nodeId: "1",
    name: "image",
    ...over,
  });

  it("按产出节点类名区分首帧 / 尾帧（pin 名都叫 image）", () => {
    expect(classifyVideoPin(pin({ classType: "LoadImageFirstFrame" }))).toBe("first-frame");
    expect(classifyVideoPin(pin({ classType: "LoadImageLastFrame" }))).toBe("last-frame");
    expect(classifyVideoPin(pin({ classType: "LoadImage" }))).toBe("reference-image");
  });

  it("节点类名认不出时按 pin 名 / 标签兜底", () => {
    expect(classifyVideoPin(pin({ name: "first_frame" }))).toBe("first-frame");
    expect(classifyVideoPin(pin({ name: "image", label: "尾帧图" }))).toBe("last-frame");
  });

  it("时长与帧率分开归类（帧率不是帧数）", () => {
    expect(classifyVideoPin(pin({ name: "frames", type: "INT" }))).toBe("frames");
    expect(classifyVideoPin(pin({ name: "length", type: "INT" }))).toBe("frames");
    expect(classifyVideoPin(pin({ name: "fps", type: "INT" }))).toBe("fps");
    expect(classifyVideoPin(pin({ name: "frame_rate", type: "INT" }))).toBe("fps");
  });

  it("连线型端口与输出不对外", () => {
    expect(classifyVideoPin(pin({ kind: "param", type: "MODEL" }))).toBe("internal");
    expect(classifyVideoPin(pin({ direction: "output" }))).toBe("internal");
  });
});

/* ── parseSizeParam ──────────────────────────────────────── */

describe("parseSizeParam", () => {
  it("解析 832x1216", () => {
    expect(parseSizeParam("832x1216")).toEqual({ width: 832, height: 1216 });
  });
  it("支持 × 分隔", () => {
    expect(parseSizeParam("512×768")).toEqual({ width: 512, height: 768 });
  });
  it("非法输入返回 null", () => {
    expect(parseSizeParam("abc")).toBeNull();
    expect(parseSizeParam("0x100")).toBeNull();
    expect(parseSizeParam(undefined)).toBeNull();
  });
});

/* ── buildEncapsulatedInputs ─────────────────────────────── */

describe("buildEncapsulatedInputs", () => {
  it("用户填的提示词/尺寸落到被识别的 pin 上", () => {
    const res = buildEncapsulatedInputs(IO, null, {
      prompt: "a dog",
      negativePrompt: "lowres",
      size: "1024x1024",
    });
    expect(valueOf(res.workflowInputs, "text")).toBe("a dog");
    // negative pin 的 name 也是 text → 用 nodeId 区分
    expect(res.workflowInputs).toContainEqual({ nodeId: "7", name: "text", value: "lowres" });
    expect(valueOf(res.workflowInputs, "width")).toBe(1024);
    expect(valueOf(res.workflowInputs, "height")).toBe(1024);
  });

  it("内部参数一律用默认值，不受用户输入影响", () => {
    const res = buildEncapsulatedInputs(IO, null, { prompt: "a dog" });
    expect(valueOf(res.workflowInputs, "steps")).toBe(28);
    expect(valueOf(res.workflowInputs, "seed")).toBe(42);
    expect(res.internalKeys).toEqual(expect.arrayContaining(["steps", "seed", "model", "out"]));
  });

  it("用户没改的参数回退工作流默认值（改的是默认值不是抹掉）", () => {
    const res = buildEncapsulatedInputs(IO, null, {});
    expect(valueOf(res.workflowInputs, "text")).toBe("a cat");
    expect(valueOf(res.workflowInputs, "width")).toBe(512);
    expect(valueOf(res.workflowInputs, "height")).toBe(768);
  });

  it("参考图落到第一个图片 pin 上", () => {
    const res = buildEncapsulatedInputs(IO, null, { referenceImages: ["ref.png"] });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "9",
      name: "image",
      value: "ref.png",
    });
    expect(res.exposed.initImage).toBe("reference-image");
  });

  it("模式默认值参与回退（模式优先于通用默认值）", () => {
    const io: WorkflowIOMap = {
      ...IO,
      steps: {
        direction: "input",
        kind: "widget",
        nodeId: "3",
        name: "steps",
        type: "INT",
        defaultValue: 28,
        modes: { fast: { defaultValue: 8 } },
      },
    };
    expect(valueOf(buildEncapsulatedInputs(io, null, {}).workflowInputs, "steps")).toBe(28);
    expect(valueOf(buildEncapsulatedInputs(io, "fast", {}).workflowInputs, "steps")).toBe(8);
  });

  it("用户给了值但工作流没有对应 pin → 记进 unmatched，不凭空造 pin", () => {
    const io: WorkflowIOMap = {
      steps: { direction: "input", kind: "widget", nodeId: "3", name: "steps", type: "INT", defaultValue: 28 },
    };
    const res = buildEncapsulatedInputs(io, null, {
      prompt: "x",
      negativePrompt: "y",
      size: "512x512",
      referenceImages: ["r.png"],
    });
    expect(res.unmatched).toEqual(
      expect.arrayContaining(["prompt", "negativePrompt", "size", "referenceImages"])
    );
    expect(res.workflowInputs).toEqual([{ nodeId: "3", name: "steps", value: 28 }]);
  });

  it("aspect/megapixels pin 纳入尺寸语义但值仍走默认值", () => {
    const io: WorkflowIOMap = {
      ar: {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "aspect_ratio",
        type: "COMBO",
        defaultValue: "16:9 (Widescreen)",
      },
      mp: { direction: "input", kind: "widget", nodeId: "1", name: "megapixels", type: "FLOAT", defaultValue: 1 },
    };
    const res = buildEncapsulatedInputs(io, null, { size: "1024x1024" });
    expect(res.exposed.ar).toBe("size-aspect");
    expect(res.exposed.mp).toBe("size-megapixels");
    expect(valueOf(res.workflowInputs, "aspect_ratio")).toBe("16:9 (Widescreen)");
    expect(valueOf(res.workflowInputs, "megapixels")).toBe(1);
  });

  it("空 IO 表安全返回空结果", () => {
    const res = buildEncapsulatedInputs(null, null, { prompt: "x" });
    expect(res.workflowInputs).toEqual([]);
    expect(res.unmatched).toEqual([]);
  });

  it("没有默认值且用户没给值的 pin 不产生 undefined 三元组", () => {
    const io: WorkflowIOMap = {
      maybe: { direction: "input", kind: "widget", nodeId: "1", name: "maybe_text", type: "STRING" },
    };
    const res = buildEncapsulatedInputs(io, null, {});
    expect(res.workflowInputs).toEqual([]);
  });
});

/* ── 视频封装（按模式） ───────────────────────────────────── */

/** 一个典型的图生视频工作流：首帧上传 + 尾帧上传（可选）+ 提示词 + 时长。 */
const VIDEO_IO: WorkflowIOMap = {
  prompt: {
    direction: "input",
    kind: "widget",
    nodeId: "1",
    name: "text",
    label: "positive_prompt",
    type: "STRING",
    multiline: true,
    defaultValue: "a running cat",
  },
  firstFrame: {
    direction: "input",
    kind: "widget",
    nodeId: "20",
    name: "image",
    type: "IMAGEUPLOAD",
    classType: "LoadImageFirstFrame",
    defaultValue: "",
  },
  lastFrame: {
    direction: "input",
    kind: "widget",
    nodeId: "21",
    name: "image",
    type: "IMAGEUPLOAD",
    classType: "LoadImageLastFrame",
    defaultValue: "",
  },
  frames: {
    direction: "input",
    kind: "widget",
    nodeId: "30",
    name: "length",
    type: "INT",
    defaultValue: 81,
  },
  steps: {
    direction: "input",
    kind: "widget",
    nodeId: "31",
    name: "steps",
    type: "INT",
    defaultValue: 25,
  },
};

describe("buildEncapsulatedInputs — 视频模式", () => {
  it("首帧落到首帧槽，时长仍走工作流默认值", () => {
    const res = buildEncapsulatedInputs(VIDEO_IO, "I2V", {
      prompt: "a bird",
      firstFrame: "frame.png",
    });
    expect(res.exposed.firstFrame).toBe("first-frame");
    expect(res.workflowInputs).toContainEqual({
      nodeId: "20",
      name: "image",
      value: "frame.png",
    });
    // 时长/步数不是对外参数 —— 用工作流默认值。
    expect(valueOf(res.workflowInputs, "length")).toBe(81);
    expect(valueOf(res.workflowInputs, "steps")).toBe(25);
    expect(res.exposed.lastFrame).toBe("last-frame");
  });

  it("首尾帧模式：尾帧落到尾帧槽，首帧不串到尾帧", () => {
    const res = buildEncapsulatedInputs(VIDEO_IO, "FLF2V", {
      firstFrame: "a.png",
      lastFrame: "b.png",
    });
    expect(res.workflowInputs).toContainEqual({ nodeId: "20", name: "image", value: "a.png" });
    expect(res.workflowInputs).toContainEqual({ nodeId: "21", name: "image", value: "b.png" });
    expect(res.unmatched).toEqual([]);
  });

  it("referenceImages 的第一张落到首帧槽（工坊视频把镜头图当首帧传）", () => {
    const res = buildEncapsulatedInputs(VIDEO_IO, "I2V", {
      referenceImages: ["shot.png"],
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "20",
      name: "image",
      value: "shot.png",
    });
    expect(res.unmatched).not.toContain("referenceImages");
  });

  it("工作流没有尾帧槽时如实上报 lastFrame 落不下去", () => {
    const io: WorkflowIOMap = {
      firstFrame: VIDEO_IO.firstFrame!,
      prompt: VIDEO_IO.prompt!,
    };
    const res = buildEncapsulatedInputs(io, "I2V", {
      firstFrame: "a.png",
      lastFrame: "b.png",
    });
    expect(res.unmatched).toContain("lastFrame");
  });

  it("模式默认值按模式解析（文生 / 图生存不同的时长）", () => {
    const io: WorkflowIOMap = {
      ...VIDEO_IO,
      frames: {
        ...VIDEO_IO.frames!,
        modes: { T2V: { defaultValue: 49 }, I2V: { defaultValue: 81 } },
      },
    };
    expect(valueOf(buildEncapsulatedInputs(io, "T2V", {}).workflowInputs, "length")).toBe(49);
    expect(valueOf(buildEncapsulatedInputs(io, "I2V", {}).workflowInputs, "length")).toBe(81);
  });

  it("文生视频：没有参考图时也是合法请求（提示词 + 默认参数）", () => {
    const res = buildEncapsulatedInputs(VIDEO_IO, "T2V", { prompt: "a sunset" });
    expect(valueOf(res.workflowInputs, "text")).toBe("a sunset");
    expect(res.unmatched).toEqual([]);
  });
});
