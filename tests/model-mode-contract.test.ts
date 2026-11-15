import { describe, expect, it } from "vitest";

import { adapterInputsFromContract } from "../src/lib/workshop/model-mode-contract";
import {
  defaultEndpointPathForKind,
  defaultInputsForMode,
  parseRemoteModeAdapters,
  parseRemoteModelAdaptersDoc,
  readFieldPath,
} from "../src/lib/workshop/remote-model-adapter";

describe("远端模型工坊模式适配器：默认契约", () => {
  it("文生图默认输入 = 提示词 + 宽高比 + 百万像素 + 倍数，输出图片", () => {
    /* 「尺寸」在适配器层就是这几行（比例 + 百万像素 + 倍数）——与工坊尺寸
     *  选择器的统一口径一致：选「分辨率」表达时档位名走 resolution 口
     *  （#3622），百万像素值照旧换算下发。 */
    const inputs = defaultInputsForMode("T2I");
    expect(inputs.map((i) => i.type)).toEqual(["prompt", "aspect-ratio", "megapixels", "multiple"]);
  });

  it("图生图默认输入以图片打头；深度图生图带深度图", () => {
    expect(defaultInputsForMode("I2I")[0]?.type).toBe("image");
    expect(defaultInputsForMode("D2I").map((i) => i.type)).toContain("depth");
    expect(defaultInputsForMode("S2I").map((i) => i.type)).toContain("lineart");
  });

  it("端点不再按模式配置（#3622）：默认路径只按类别给（未配置时请求侧推导用）", () => {
    expect(defaultEndpointPathForKind("image")).toBe("/images/generations");
    expect(defaultEndpointPathForKind("video")).toBe("/videos/generations");
    expect(defaultInputsForMode("I2V")[0]?.type).toBe("image");
  });
});

describe("远端模型工坊模式适配器：解析与归一化", () => {
  it("丢弃非法项（缺模式 / 缺字段映射 / 未知类型），模式去重并大写", () => {
    const adapters = parseRemoteModeAdapters([
      {
        mode: "t2i",
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

  it("适配器行不再带端点（#3622）：旧数据里的 endpointPath 被丢弃，不进归一化结果", () => {
    const adapters = parseRemoteModeAdapters([
      {
        mode: "I2V",
        endpointPath: "/videos/generations",
        inputs: [{ type: "image", field: "image" }],
      },
    ]);
    expect(adapters[0]).not.toHaveProperty("endpointPath");
  });
});

describe("远端模型工坊适配器存档（模型级 envelope，#3622）", () => {
  it("新版形状：端点路径 + 各模式适配器一起归一化", () => {
    const doc = parseRemoteModelAdaptersDoc({
      endpointPath: "/v1/images/generations",
      adapters: [{ mode: "t2i", inputs: [{ type: "prompt", field: "prompt" }] }],
    });
    expect(doc.endpointPath).toBe("/v1/images/generations");
    expect(doc.adapters).toHaveLength(1);
    expect(doc.adapters[0]?.mode).toBe("T2I");
  });

  it("旧版形状（裸适配器数组）兼容读取：端点视为未配置，请求侧按类别推导", () => {
    const doc = parseRemoteModelAdaptersDoc([
      { mode: "T2I", endpointPath: "/x", inputs: [{ type: "prompt", field: "prompt" }] },
    ]);
    expect(doc.endpointPath).toBe("");
    expect(doc.adapters).toHaveLength(1);
  });

  it("端点路径强制根相对；坏数据按空档处理", () => {
    expect(
      parseRemoteModelAdaptersDoc({ endpointPath: "v1/images", adapters: [] }).endpointPath,
    ).toBe("/v1/images");
    expect(parseRemoteModelAdaptersDoc("junk")).toEqual({ endpointPath: "", adapters: [] });
    expect(parseRemoteModelAdaptersDoc(null)).toEqual({ endpointPath: "", adapters: [] });
  });
});

describe("契约 → 适配器的默认映射", () => {
  it("作者自定义的口不生成默认行（远端字段名没法猜，留给适配器页手填）", () => {
    /* 与「第 2 张起的参考图」同一条口径：没有约定字段名就不猜 —— 猜错时请求体
     *  会带上一个接口不认识的字段，而用户看不出来。 */
    const rows = adapterInputsFromContract({
      mode: "T2I",
      inputs: ["prompt", "custom-text-1", "custom-number-2"],
      output: "image",
      customInputs: [
        { id: "custom-text-1", label: "水彩风格", kind: "text" },
        { id: "custom-number-2", label: "强度", kind: "number" },
      ],
    });
    expect(rows).toEqual([{ type: "prompt", field: "prompt" }]);
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
