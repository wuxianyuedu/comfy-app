/* ── 工坊封装：落点只认作者连的线 ──
 *
 * 这一层不做任何「按名字 / 节点类名猜槽位」——某个对外口落到工作流的哪一行，
 * 由工作流库里作者拖出来的连线声明（`paramMap.source.mode:<模式>`）。所以每条
 * 「值落到某行」的用例都**先给一条线**；没有线就没有落点（如实上报 unmatched）。
 *
 * 名字启发式的用例（`classifyWorkshopPin` / `classifyVideoPin`）已随实现一起
 * 删除：那套判据本身就是被去掉的东西（猜错时用户无从察觉）。
 */
import { describe, it, expect } from "vitest";
import { buildEncapsulatedInputs } from "./workflow-encapsulation";
import {
  isVideoMode,
  modeUsesFirstFrame,
  modeUsesLastFrame,
} from "~/lib/workflow/workflow-exposed-params";
import type {
  WorkflowIOEntry,
  WorkflowIOMap,
} from "~/lib/workflow/workflow-io-types";
import type { SizeSpec } from "~/lib/media/size-presets";

/** 尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数）—— 工坊下发的唯一尺寸口径。 */
const sizeSpec = (over: Partial<SizeSpec> = {}): SizeSpec => ({
  ratio: "3:4",
  clarity: "1k",
  multiple: 64,
  ...over,
});

/** 作者在某个模式下连的线（落库形状 `paramMap.source.mode:<模式>`）。 */
function wire(
  mode: string,
  lines: Record<string, string | null>,
): Record<string, unknown> {
  return { source: { [`mode:${mode}`]: lines } };
}

/** 取 workflowInputs 里的某个 name 的值。 */
function valueOf(
  inputs: { name: string; value: unknown }[],
  name: string,
): unknown {
  return inputs.find((i) => i.name === name)?.value;
}

/* ── 测试夹具 ─────────────────────────────────────────────── */

/** 一个典型的自定义工作流 IO：提示词 + 负向 + 尺寸对 + 若干内部参数 + 图片口。 */
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

/* ── 落点只认作者连的线 ───────────────────────────────────── */

describe("落点只认作者连的线", () => {
  it("提示词 / 负向各自连线：值落到各自那一行", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: "text", negative: "negative" }),
      mode: "T2I",
      values: { prompt: "a dog", negativePrompt: "lowres" },
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "6",
      name: "text",
      value: "a dog",
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "7",
      name: "text",
      value: "lowres",
    });
    expect(res.unmatched).toEqual([]);
  });

  it("两行同名 `text` 也能分清：谁是谁由线说，不由名字说", () => {
    /* 真实文生图里两个 CLIPTextEncode 的 pin 名与显示名完全一样。旧实现只能靠
     * 「名字里有没有 negative」猜，猜不出就把口子丢了；现在作者把两个口各连到
     * 自己那一行，两条线指向不同节点 —— 名字一样也不影响。 */
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: "negative", negative: "text" }),
      mode: "T2I",
      values: { prompt: "正向", negativePrompt: "负向" },
    });
    /* 线说了算：正向口这次落到 nodeId 7，负向口落到 nodeId 6。 */
    expect(res.workflowInputs).toContainEqual({
      nodeId: "7",
      name: "text",
      value: "正向",
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "6",
      name: "text",
      value: "负向",
    });
  });

  it("没连线的口给了值 → 如实进 unmatched，不替作者挑端口", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: null,
      mode: "T2I",
      values: { prompt: "x" },
    });
    expect(res.unmatched).toContain("prompt");
    /* 不下发任何东西：工作流图内自带的值照旧生效（工坊不塞默认值）。 */
    expect(res.workflowInputs).toEqual([]);
  });

  it("未连线的内部参数不下发（不再是「把每个 pin 的默认值都塞进载荷」）", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: "text" }),
      mode: "T2I",
      values: { prompt: "x" },
    });
    expect(res.workflowInputs).toEqual([
      { nodeId: "6", name: "text", value: "x" },
    ]);
  });

  it("作者显式断开（null）的口：值落不下去，如实上报", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: null }),
      mode: "T2I",
      values: { prompt: "x" },
    });
    expect(res.unmatched).toContain("prompt");
    expect(res.workflowInputs).toEqual([]);
  });

  it("落点端口已被改版移除 → 按未配置处理，不静默落空", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: "9::widget::gone" }),
      mode: "T2I",
      values: { prompt: "x" },
    });
    expect(res.unmatched).toContain("prompt");
    expect(res.workflowInputs).toEqual([]);
  });

  it("模式为空：不存在脱离模式的手工线 → 一律未配置", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: "text" }),
      mode: null,
      values: { prompt: "x" },
    });
    expect(res.unmatched).toContain("prompt");
    expect(res.workflowInputs).toEqual([]);
  });

  it("另一模式的线不在本模式生效", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("I2I", { prompt: "text" }),
      mode: "T2I",
      values: { prompt: "x" },
    });
    expect(res.unmatched).toContain("prompt");
  });
});

/* ── 尺寸：形态由作者连的子口声明 ─────────────────────────── */

describe("尺寸：形态由作者连的子口声明，值按形态派", () => {
  it("宽 + 高两条线：宽高按场景尺寸表算出", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", {
        "size-width": "width",
        "size-height": "height",
      }),
      mode: "T2I",
      values: { size: sizeSpec() },
    });
    expect(valueOf(res.workflowInputs, "width")).toBe(768);
    expect(valueOf(res.workflowInputs, "height")).toBe(1024);
    expect(res.unmatched).toEqual([]);
  });

  it("比例 + 像素量 + 倍数三条线：各自按形态取值（比例写端口自己的候选）", () => {
    const io: WorkflowIOMap = {
      ar: {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "aspect_ratio",
        type: "COMBO",
        defaultValue: "16:9 (Widescreen)",
        options: ["1:1 (Square)", "16:9 (Widescreen)", "9:16 (Portrait)"],
      },
      mp: {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "megapixels",
        type: "FLOAT",
        defaultValue: 1,
      },
      mul: {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "multiple",
        type: "INT",
        defaultValue: 8,
      },
    };
    const res = buildEncapsulatedInputs({
      io,
      paramMap: wire("T2I", {
        "size-aspect": "ar",
        "size-megapixels": "mp",
        "size-multiple": "mul",
      }),
      mode: "T2I",
      values: {
        size: sizeSpec({ ratio: "9:16 竖屏", clarity: "2M", multiple: 32 }),
      },
    });
    /* 比例必须写端口自己声明的候选值（逐字命中），不是工坊的短标签。 */
    expect(valueOf(res.workflowInputs, "aspect_ratio")).toBe("9:16 (Portrait)");
    expect(valueOf(res.workflowInputs, "megapixels")).toBe(2);
    expect(valueOf(res.workflowInputs, "multiple")).toBe(32);
    expect(res.unmatched).toEqual([]);
  });

  it("同一档位在视频场景是另一组值（场景由模式码推）", () => {
    const io: WorkflowIOMap = {
      w: {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "width",
        type: "INT",
      },
      h: {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "height",
        type: "INT",
      },
    };
    const res = buildEncapsulatedInputs({
      io,
      paramMap: wire("I2V", {
        "size-width": "w",
        "size-height": "h",
      }),
      mode: "I2V",
      values: { size: sizeSpec({ ratio: "16:9 横屏" }) },
    });
    expect(valueOf(res.workflowInputs, "width")).toBe(1280);
    expect(valueOf(res.workflowInputs, "height")).toBe(720);
  });

  it("只连了一个子口：算接住了（另一维由图内默认值补）", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { "size-width": "width" }),
      mode: "T2I",
      values: { size: sizeSpec() },
    });
    expect(res.workflowInputs).toEqual([
      { nodeId: "5", name: "width", value: 768 },
    ]);
    /* 工坊只送一个尺寸表达，工作流接住其中一路即算接住 —— 不报子口级噪音。 */
    expect(res.unmatched).toEqual([]);
  });

  it("一个尺寸子口都没连：值落不下去，如实上报一次 size", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: "text" }),
      mode: "T2I",
      values: { size: sizeSpec() },
    });
    expect(res.workflowInputs).toEqual([]);
    expect(res.unmatched).toEqual(["size"]);
  });

  it("比例候选里认不出 → 不写非法值（该子口不上报，图内默认值生效）", () => {
    const io: WorkflowIOMap = {
      ar: {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "aspect_ratio",
        type: "COMBO",
        defaultValue: "Widescreen",
        options: ["Widescreen", "Portrait"],
      },
    };
    const res = buildEncapsulatedInputs({
      io,
      paramMap: wire("T2I", { "size-aspect": "ar" }),
      mode: "T2I",
      values: { size: sizeSpec({ ratio: "16:9 横屏" }) },
    });
    /* 写一个解不出比例的候选只会让 ComfyUI 静默回落到第一个选项（看起来像
     *  「改了没生效」），所以不写 —— 端口图内的默认值照旧生效。 */
    expect(res.workflowInputs).toEqual([]);
  });
});

/* ── 图片槽位：同名 pin 由线区分 ─────────────────────────── */

/** 一个典型的图生视频工作流：两个上传口**同名同类型**（只有节点不同）。 */
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
    defaultValue: "",
  },
  lastFrame: {
    direction: "input",
    kind: "widget",
    nodeId: "21",
    name: "image",
    type: "IMAGEUPLOAD",
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
};

describe("图片槽位：同名 pin 由线区分，不看名字 / 节点类名", () => {
  it("首尾帧：两个都叫 image 的上传口，作者连给谁就是谁", () => {
    /* 旧实现按节点类名（LoadImageFirstFrame / LoadImageLastFrame）或 pin 名里的
     *  「首帧 / 尾帧」猜；两个口名字一样、类名又认不出时只能猜错。现在两条线
     *  各自指向一个节点，首帧不会串到尾帧。 */
    const res = buildEncapsulatedInputs({
      io: VIDEO_IO,
      paramMap: wire("FLF2V", {
        "first-frame": "firstFrame",
        "last-frame": "lastFrame",
      }),
      mode: "FLF2V",
      values: { firstFrame: "a.png", lastFrame: "b.png" },
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "20",
      name: "image",
      value: "a.png",
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "21",
      name: "image",
      value: "b.png",
    });
    expect(res.unmatched).toEqual([]);
  });

  it("作者把首帧连到第二个上传口 → 就落那一行（名字里的 first 不算数）", () => {
    const res = buildEncapsulatedInputs({
      io: VIDEO_IO,
      paramMap: wire("I2V", { "first-frame": "lastFrame" }),
      mode: "I2V",
      values: { firstFrame: "a.png" },
    });
    expect(res.workflowInputs).toEqual([
      { nodeId: "21", name: "image", value: "a.png" },
    ]);
  });

  it("镜头图（referenceImages 第一张）落到作者连的首帧口", () => {
    const res = buildEncapsulatedInputs({
      io: VIDEO_IO,
      paramMap: wire("I2V", { "first-frame": "firstFrame" }),
      mode: "I2V",
      values: { referenceImages: ["shot.png"] },
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "20",
      name: "image",
      value: "shot.png",
    });
    expect(res.unmatched).toEqual([]);
  });

  it("尾帧口没连线（工作流没有尾帧槽）→ 如实上报，不塞给别的上传口", () => {
    const io: WorkflowIOMap = {
      prompt: VIDEO_IO.prompt!,
      firstFrame: VIDEO_IO.firstFrame!,
    };
    const res = buildEncapsulatedInputs({
      io,
      paramMap: wire("I2V", { "first-frame": "firstFrame" }),
      mode: "I2V",
      values: { firstFrame: "a.png", lastFrame: "b.png" },
    });
    expect(res.unmatched).toContain("last-frame");
    expect(res.workflowInputs).toContainEqual({
      nodeId: "20",
      name: "image",
      value: "a.png",
    });
  });

  it("工坊给了图、但这个模式不暴露图片口 → 如实上报（不静默丢图）", () => {
    /* T2I 契约里只有提示词 / 负向 / 尺寸：给了参考图却没有任何口接住 ——
     *  映射层只遍历契约条目，看不见「模式压根没有这个口」，由本层补报。 */
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: "text" }),
      mode: "T2I",
      values: { prompt: "x", referenceImages: ["r.png"] },
    });
    expect(res.unmatched).toContain("first-frame");
  });

  it("图生图：两张参考图各落到作者连的那一行（同名 pin 也分得清）", () => {
    const io: WorkflowIOMap = {
      ...IO,
      ref2: { ...IO.initImage!, nodeId: "11" },
    };
    const res = buildEncapsulatedInputs({
      io,
      paramMap: wire("I2I", {
        "reference-image": "initImage",
        "reference-image-2": "ref2",
      }),
      mode: "I2I",
      values: { referenceImages: ["a.png", "b.png"] },
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "9",
      name: "image",
      value: "a.png",
    });
    expect(res.workflowInputs).toContainEqual({
      nodeId: "11",
      name: "image",
      value: "b.png",
    });
  });
});

/* ── 时长：单位与候选由落点端口声明 ───────────────────────── */

describe("时长：单位与候选由落点端口声明", () => {
  const pinOf = (over: Partial<WorkflowIOEntry>): WorkflowIOEntry => ({
    direction: "input",
    kind: "widget",
    nodeId: "12",
    name: "length",
    type: "INT",
    defaultValue: 81,
    ...over,
  });

  it("按帧表达的端口吃 frames，按秒表达的端口吃 duration", () => {
    const byFrames = buildEncapsulatedInputs({
      io: { length: pinOf({}) },
      paramMap: wire("I2V", { duration: "length" }),
      mode: "I2V",
      values: { frames: 49 },
    });
    expect(valueOf(byFrames.workflowInputs, "length")).toBe(49);

    const bySeconds = buildEncapsulatedInputs({
      io: {
        secs: pinOf({
          nodeId: "13",
          name: "duration",
          type: "FLOAT",
          defaultValue: 5,
        }),
      },
      paramMap: wire("I2V", { duration: "secs" }),
      mode: "I2V",
      values: { duration: 8 },
    });
    expect(valueOf(bySeconds.workflowInputs, "duration")).toBe(8);
  });

  it("端口声明了候选（COMBO）时按候选收敛：命不中就取最近档", () => {
    const io = {
      length: pinOf({ defaultValue: 16, options: ["16", "24", "32"] }),
    };
    const exact = buildEncapsulatedInputs({
      io,
      paramMap: wire("I2V", { duration: "length" }),
      mode: "I2V",
      values: { frames: 24 },
    });
    expect(valueOf(exact.workflowInputs, "length")).toBe(24);

    /* 81 不在候选里 → 取最近档 32，而不是写 81 让 ComfyUI 静默回落。 */
    const near = buildEncapsulatedInputs({
      io,
      paramMap: wire("I2V", { duration: "length" }),
      mode: "I2V",
      values: { frames: 81 },
    });
    expect(valueOf(near.workflowInputs, "length")).toBe(32);
  });

  it("候选不是数字 → 不写非法值（值不落，图内默认值生效）", () => {
    const res = buildEncapsulatedInputs({
      io: { length: pinOf({ defaultValue: 16, options: ["auto", "long"] }) },
      paramMap: wire("I2V", { duration: "length" }),
      mode: "I2V",
      values: { frames: 81 },
    });
    expect(res.workflowInputs).toEqual([]);
  });

  it("时长口没连线 → 不落值", () => {
    const res = buildEncapsulatedInputs({
      io: { length: pinOf({}) },
      paramMap: wire("I2V", { prompt: "length" }),
      mode: "I2V",
      values: { frames: 49 },
    });
    expect(res.workflowInputs).toEqual([]);
    expect(res.unmatched).toContain("duration");
  });
});

/* ── 边界 ────────────────────────────────────────────────── */

describe("边界", () => {
  it("空 IO 表安全返回空结果", () => {
    const res = buildEncapsulatedInputs({
      io: null,
      paramMap: wire("T2I", { prompt: "text" }),
      mode: "T2I",
      values: { prompt: "x" },
    });
    expect(res.workflowInputs).toEqual([]);
    expect(res.unmatched).toEqual([]);
  });

  it("什么都没给 → 什么都不下发，也不报未配置", () => {
    const res = buildEncapsulatedInputs({
      io: IO,
      paramMap: wire("T2I", { prompt: "text" }),
      mode: "T2I",
      values: {},
    });
    expect(res.workflowInputs).toEqual([]);
    expect(res.unmatched).toEqual([]);
  });

  it("畸形 paramMap 不抛（按「没有线」处理）", () => {
    for (const bad of [42, "x", [], { source: [] }, { source: { nope: {} } }]) {
      const res = buildEncapsulatedInputs({
        io: IO,
        paramMap: bad,
        mode: "T2I",
        values: { prompt: "x" },
      });
      expect(res.unmatched).toContain("prompt");
    }
  });
});

/* ── 视频模式判定（契约表导出） ───────────────────────────── */

describe("视频模式判定", () => {
  it("视频模式码命中，图类模式码不命中", () => {
    for (const code of ["T2V", "I2V", "TI2V", "FLF2V", "S2V", "V2V"]) {
      expect(isVideoMode(code)).toBe(true);
    }
    for (const code of [
      "T2I",
      "I2I",
      "Inpaint",
      "Upscale",
      "",
      null,
      undefined,
    ]) {
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
