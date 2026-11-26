// extractRuntimeParams 的回归测试：重点锁住「一个工作流含多个采样节点」的新行为。
// 此前实现只取 graph 顺序第一个 KSampler、后续静默丢弃；现在全部收进 samplers，
// 顶层字段仍反映主采样器（第一个）以兼容种子落库 / manifest / 日志。

import { describe, expect, it } from "vitest";

import { collectOutputs, extractRuntimeParams, internalPreviewNodeIds } from "./executor-outputs";

/** 造一条 history entry：prompt[2] 是被执行图（class_type + inputs）。 */
function entryWithGraph(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): unknown {
  return { prompt: ["id", "number", graph, {}, {}] };
}

describe("extractRuntimeParams 采样器提取", () => {
  it("单个 KSampler：顶层与 samplers[0] 一致，samplers 长度为 1", () => {
    const out = extractRuntimeParams(
      entryWithGraph({
        "76:69": {
          class_type: "KSampler",
          inputs: {
            seed: 123,
            steps: 25,
            cfg: 4,
            sampler_name: "res_multistep",
            scheduler: "simple",
            denoise: 1,
          },
        },
      }),
    );
    expect(out.seed).toBe(123);
    expect(out.samplerNodeId).toBe("76:69");
    expect(out.samplerClassType).toBe("KSampler");
    expect(out.samplers).toHaveLength(1);
    expect(out.samplers?.[0]).toMatchObject({
      nodeId: "76:69",
      classType: "KSampler",
      seed: 123,
      steps: 25,
    });
  });

  it("两个 KSampler：samplers 各留一份，顶层取第一个（主采样器）", () => {
    const out = extractRuntimeParams(
      entryWithGraph({
        "1:1": {
          class_type: "KSampler",
          inputs: { seed: 111, steps: 20, cfg: 3.5 },
        },
        "2:2": {
          class_type: "KSampler",
          inputs: { seed: 222, steps: 8, cfg: 7 },
        },
      }),
    );
    expect(out.samplers).toHaveLength(2);
    expect(out.samplers?.map((s) => s.nodeId)).toEqual(["1:1", "2:2"]);
    expect(out.samplers?.map((s) => s.seed)).toEqual([111, 222]);
    // 顶层只反映主采样器（第一个），不被第二个覆盖
    expect(out.seed).toBe(111);
    expect(out.steps).toBe(20);
    expect(out.samplerNodeId).toBe("1:1");
  });

  it("KSamplerAdvanced 读 noise_seed；混排时 samplers 保留各自类名", () => {
    const out = extractRuntimeParams(
      entryWithGraph({
        "9:9": {
          class_type: "KSamplerAdvanced",
          inputs: { noise_seed: 555, steps: 30 },
        },
        "10:10": { class_type: "KSampler", inputs: { seed: 666 } },
      }),
    );
    expect(out.samplers?.[0]).toMatchObject({
      nodeId: "9:9",
      classType: "KSamplerAdvanced",
      seed: 555,
    });
    expect(out.samplers?.[1]?.seed).toBe(666);
    expect(out.seed).toBe(555); // 主采样器是第一个（Advanced）
  });

  it("非采样节点被忽略；没有采样节点时返回空对象", () => {
    const out = extractRuntimeParams(
      entryWithGraph({
        "3:3": { class_type: "CheckpointLoaderSimple", inputs: {} },
        "4:4": { class_type: "VAEDecode", inputs: {} },
      }),
    );
    expect(out.samplers).toBeUndefined();
    expect(out.seed).toBeUndefined();
    expect(out.samplerNodeId).toBeUndefined();
  });

  it("seed 为数字字符串也能解析；缺字段留 undefined 不臆造", () => {
    const out = extractRuntimeParams(
      entryWithGraph({
        "5:5": { class_type: "KSampler", inputs: { seed: "9007199254740991" } },
      }),
    );
    expect(out.seed).toBe(9_007_199_254_740_991);
    expect(out.samplers?.[0]?.steps).toBeUndefined();
  });

  it("graph 缺失 / 形态非法时安全返回空对象", () => {
    expect(extractRuntimeParams(null)).toEqual({});
    expect(extractRuntimeParams({ prompt: "not-an-array" })).toEqual({});
    expect(extractRuntimeParams({})).toEqual({});
  });
});

describe("collectOutputs 未知键兜底的 temp 过滤（ISSUE #4910）", () => {
  it("SaveImage 的 output 产物照常收集", () => {
    const out = collectOutputs({
      "9": { images: [{ filename: "final_00001_.png", subfolder: "", type: "output" }] },
    });
    expect(out.images).toEqual([{ filename: "final_00001_.png", subfolder: "", type: "output" }]);
    expect(out.others).toEqual([]);
  });

  it("ImageCompare 的 a_images/b_images（type=temp 调试图）不再被当成产物；真 output 兜底照收", () => {
    const out = collectOutputs({
      "62": {
        a_images: [{ filename: "comfy.compare.a_temp_1_.png", subfolder: "", type: "temp" }],
        b_images: [{ filename: "comfy.compare.b_temp_1_.png", subfolder: "", type: "temp" }],
      },
      "80": { meshes: [{ filename: "model.glb", subfolder: "", type: "output" }] },
    });
    expect(out.images).toEqual([]);
    expect(out.others).toEqual([{ filename: "model.glb", subfolder: "", type: "output" }]);
  });

  it("兜底数组里 output 与 temp 混排时只收 output（all-file-shaped 守卫不变）", () => {
    const out = collectOutputs({
      "62": {
        a_images: [
          { filename: "keep.png", subfolder: "", type: "output" },
          { filename: "drop.png", subfolder: "", type: "temp" },
        ],
      },
    });
    expect(out.others).toEqual([{ filename: "keep.png", subfolder: "", type: "output" }]);
  });
});

describe("内部预览节点的 text 不算产物（ISSUE #5109）", () => {
  const outputs = {
    "9": { images: [{ filename: "final_00001_.png", subfolder: "", type: "output" }] },
    "23:18": { text: ['{"expanded_caption":"...","aspect_ratio":"1:1"}'] },
    "30": { text: ["这是用户要的文字交付"] },
  };
  const graph = {
    "9": { class_type: "SaveImage", inputs: {} },
    "23:18": { class_type: "PreviewAny", inputs: { source: ["23:26", 0] } },
    "23:26": { class_type: "JsonExtractString", inputs: {} },
    "30": { class_type: "ShowText", inputs: {} },
  };
  const entry = { prompt: ["id", "number", graph, {}, {}] };

  it("internalPreviewNodeIds 从执行图认出 PreviewAny，不误伤 ShowText", () => {
    expect([...internalPreviewNodeIds(entry)]).toEqual(["23:18"]);
  });

  it("过滤后只剩真交付：1 张图 + ShowText 的文本，扩写预览不落 txt_0.txt", () => {
    const out = collectOutputs(outputs, { skipTextNodeIds: internalPreviewNodeIds(entry) });
    expect(out.images).toHaveLength(1);
    expect(out.texts).toEqual(["这是用户要的文字交付"]);
  });

  it("不传过滤集时维持旧行为（图缺失时不凭空丢文本）", () => {
    expect(collectOutputs(outputs).texts).toHaveLength(2);
    expect([...internalPreviewNodeIds({})]).toEqual([]);
    expect([...internalPreviewNodeIds({ prompt: "not-an-array" })]).toEqual([]);
  });
});
