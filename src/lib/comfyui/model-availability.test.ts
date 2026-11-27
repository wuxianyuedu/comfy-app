/**
 * 工作流钉死的模型文件预检（ISSUE #5144）：纯派生负责形状，异步壳只负责取清单。
 */
import { describe, expect, it, vi } from "vitest";

/* 本用例只判纯派生形状：异步壳依赖 DB / env，换桩避免加载仓储触发 env 校验。 */
vi.mock("~/lib/models", () => ({ localModelFileNames: vi.fn() }));

import { missingModelFiles, modelFileNamesInGraph } from "./model-availability";

const RAW_GRAPH = {
  nodes: [
    {
      id: 23,
      type: "MiniMaxH3ImageConditioning",
      widgets_values: ["qwen3vl_32b_minimax_h3_int8_convrot.safetensors", 42],
    },
    {
      id: 14,
      type: "CheckpointLoaderSimple",
      widgets_values: ["z_image_int8_convrot.safetensors"],
    },
  ],
};

describe("modelFileNamesInGraph（ISSUE #5144）", () => {
  it("RAW 图的 widgets_values 与 API 图的 inputs 都能扫出模型名，去重保序", () => {
    expect(modelFileNamesInGraph(RAW_GRAPH)).toEqual([
      "qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
      "z_image_int8_convrot.safetensors",
    ]);
    expect(modelFileNamesInGraph({ "23": { inputs: { ckpt_name: "ae.safetensors" } } })).toEqual([
      "ae.safetensors",
    ]);
    expect(modelFileNamesInGraph(null)).toEqual([]);
  });
});

describe("missingModelFiles", () => {
  it("只报本机没有的文件；本机清单为空时不要把全部误报为缺失由调用方决定", () => {
    expect(missingModelFiles(RAW_GRAPH, new Set(["z_image_int8_convrot.safetensors"]))).toEqual([
      "qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
    ]);
    expect(missingModelFiles(RAW_GRAPH, new Set(modelFileNamesInGraph(RAW_GRAPH)))).toEqual([]);
  });

  it("识别同模型的 nvfp4 量化版本（用于给出「换量化版本」建议）", () => {
    const missing = missingModelFiles(
      RAW_GRAPH,
      new Set(["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"]),
    );
    expect(missing).toContain("qwen3vl_32b_minimax_h3_int8_convrot.safetensors");
  });
});
