// extractRuntimeParams 的回归测试：重点锁住「一个工作流含多个采样节点」的新行为。
// 此前实现只取 graph 顺序第一个 KSampler、后续静默丢弃；现在全部收进 samplers，
// 顶层字段仍反映主采样器（第一个）以兼容种子落库 / manifest / 日志。

import { describe, expect, it } from "vitest";

import { extractRuntimeParams } from "./executor-outputs";

/** 造一条 history entry：prompt[2] 是被执行图（class_type + inputs）。 */
function entryWithGraph(
  graph: Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >,
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
    expect(out.seed).toBe(9007199254740991);
    expect(out.samplers?.[0]?.steps).toBeUndefined();
  });

  it("graph 缺失 / 形态非法时安全返回空对象", () => {
    expect(extractRuntimeParams(null)).toEqual({});
    expect(extractRuntimeParams({ prompt: "not-an-array" })).toEqual({});
    expect(extractRuntimeParams({})).toEqual({});
  });
});
