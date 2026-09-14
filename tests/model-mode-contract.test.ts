import { describe, expect, it } from "vitest";

import {
  defaultEndpointPathForMode,
  defaultInputsForMode,
  parseRemoteModeAdapters,
  readFieldPath,
} from "../src/lib/workshop/model-mode-contract";

describe("远端模型工坊模式适配器：默认契约", () => {
  it("文生图默认输入 = 提示词 + 宽高比 + 百万像素 + 倍数，输出图片", () => {
    /* 「尺寸」在适配器层就是这三行（比例 + 百万像素 + 倍数）——与工坊尺寸
     *  选择器的统一口径一致：选「分辨率」时换算成这三个值再下发。 */
    const inputs = defaultInputsForMode("T2I");
    expect(inputs.map((i) => i.type)).toEqual([
      "prompt",
      "aspect-ratio",
      "megapixels",
      "multiple",
    ]);
    expect(defaultEndpointPathForMode("T2I")).toBe("/images/generations");
  });

  it("图生图默认输入以图片打头；深度图生图带深度图", () => {
    expect(defaultInputsForMode("I2I")[0]?.type).toBe("image");
    expect(defaultInputsForMode("D2I").map((i) => i.type)).toContain("depth");
    expect(defaultInputsForMode("S2I").map((i) => i.type)).toContain("lineart");
  });

  it("视频模式端点走 /videos/generations，I2V 以首帧图输入", () => {
    expect(defaultEndpointPathForMode("I2V")).toBe("/videos/generations");
    expect(defaultInputsForMode("I2V")[0]?.type).toBe("image");
  });
});

describe("远端模型工坊模式适配器：解析与归一化", () => {
  it("丢弃非法项（缺模式 / 缺字段映射 / 未知类型），模式去重并大写", () => {
    const adapters = parseRemoteModeAdapters([
      {
        mode: "t2i",
        endpointPath: "/v1/images/generations",
        inputs: [
          { type: "prompt", field: "prompt" },
          { type: "bogus", field: "x" },
          { type: "seed", field: "" },
        ],
        outputField: "data.0.url",
      },
      { mode: "t2i", inputs: [{ type: "prompt", field: "dup" }] },
      { mode: "", inputs: [{ type: "prompt", field: "p" }] },
      { mode: "I2I", inputs: [] },
    ]);
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.mode).toBe("T2I");
    expect(adapters[0]?.inputs.map((i) => i.type)).toEqual(["prompt"]);
    expect(adapters[0]?.outputField).toBe("data.0.url");
  });

  it("endpointPath 缺省按模式类别补默认值", () => {
    const adapters = parseRemoteModeAdapters([
      { mode: "I2V", inputs: [{ type: "image", field: "image" }] },
    ]);
    expect(adapters[0]?.endpointPath).toBe("/videos/generations");
  });
});

describe("远端模型工坊模式适配器：产物字段路径", () => {
  it("支持点路径与数组下标", () => {
    const payload = { data: [{ url: "https://x/a.png" }], meta: { id: 7 } };
    expect(readFieldPath(payload, "data.0.url")).toBe("https://x/a.png");
    expect(readFieldPath(payload, "meta.id")).toBe(7);
    expect(readFieldPath(payload, "nope.path")).toBeNull();
    expect(readFieldPath(payload, "")).toBeNull();
  });
});
