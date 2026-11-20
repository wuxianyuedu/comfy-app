/**
 * 测试模型页「本地工作流候选」的模式默认值播种（ISSUE #4633）：
 * 统一输入的默认值来自工作流在所选模式下的端口默认值（模式覆盖层生效），
 * 不再一律是页面的「1:1 / 1k」通用预设。
 */
import { describe, expect, it } from "vitest";

import { workflowModeDefaults } from "./model-test-defaults";

/** 造一个 widget 端口（ioKey = `nodeId::widget::name`，与富化链一致）。 */
function widget(
  nodeId: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    direction: "input",
    kind: "widget",
    nodeId,
    name,
    label: name,
    ...extra,
  };
}

const IO = {
  "7::widget::replace": widget("7", "replace", {
    type: "STRING",
    defaultValue: "",
    multiline: true,
  }),
  "7::widget::aspect_ratio": widget("7", "aspect_ratio", {
    type: "COMBO",
    defaultValue: "16:9 (Widescreen)",
  }),
  "7::widget::megapixels": widget("7", "megapixels", { type: "INT", defaultValue: 2 }),
  "7::widget::multiple": widget("7", "multiple", { type: "INT", defaultValue: 64 }),
  "7::widget::seed": widget("7", "seed", {
    type: "INT",
    defaultValue: 123,
    seedMode: "fixed",
  }),
};

const PARAM_MAP = {
  source: {
    "mode:T2I": {
      prompt: "7::widget::replace",
      "size-aspect": "7::widget::aspect_ratio",
      "size-megapixels": "7::widget::megapixels",
      "size-multiple": "7::widget::multiple",
      seed: "7::widget::seed",
    },
  },
};

describe("workflowModeDefaults（ISSUE #4633）", () => {
  it("按模式播种工作流端口默认值：比例短标签、百万像素、倍数、固定种子", () => {
    const out = workflowModeDefaults({ io: IO, mode: "T2I", paramMap: PARAM_MAP });
    expect(out["aspect-ratio"]).toBe("16:9");
    expect(out.megapixels).toBe("2");
    expect(out.multiple).toBe("64");
    expect(out.seed).toBe("123");
  });

  it("模式覆盖层的默认值压过图内默认值", () => {
    const io = {
      ...IO,
      "7::widget::aspect_ratio": widget("7", "aspect_ratio", {
        type: "COMBO",
        defaultValue: "16:9 (Widescreen)",
        modeOverrides: { T2I: { defaultValue: "9:16 (Portrait)" } },
      }),
    };
    const out = workflowModeDefaults({ io, mode: "T2I", paramMap: PARAM_MAP });
    expect(out["aspect-ratio"]).toBe("9:16");
  });

  it("空默认值不播种（提示词留空，页面的占位提示照常显示）", () => {
    const out = workflowModeDefaults({ io: IO, mode: "T2I", paramMap: PARAM_MAP });
    expect(out.prompt).toBeUndefined();
    expect(out.negative).toBeUndefined();
  });

  it("random 行为的种子不播种（播种具体数字会把随机钉死成固定值）", () => {
    const io = {
      ...IO,
      "7::widget::seed": widget("7", "seed", {
        type: "INT",
        defaultValue: 0,
        seedMode: "random",
      }),
    };
    const out = workflowModeDefaults({ io, mode: "T2I", paramMap: PARAM_MAP });
    expect(out.seed).toBeUndefined();
  });

  it("没画线的口不播种（该口运行期由工作流图内默认值兜底，映射层看不见它）", () => {
    const paramMap = {
      source: { "mode:T2I": { "size-aspect": "7::widget::aspect_ratio" } },
    };
    const out = workflowModeDefaults({ io: IO, mode: "T2I", paramMap });
    expect(out["aspect-ratio"]).toBe("16:9");
    expect(out.prompt).toBeUndefined();
    expect(out.megapixels).toBeUndefined();
  });

  it("io 为空 / 没有解析结果时返回空表（调用方回落页面通用默认）", () => {
    expect(workflowModeDefaults({ io: {}, mode: "T2I", paramMap: PARAM_MAP })).toEqual({});
    expect(workflowModeDefaults({ io: undefined, mode: "T2I", paramMap: PARAM_MAP })).toEqual({});
  });
});

describe("workflowModeDefaults — 尺寸表达随工作流（ISSUE #4633 实测补充）", () => {
  it("工作流用百万像素 + 倍数表达尺寸时，清掉通用分辨率档（选择器按工作流的百万像素显示）", () => {
    const out = workflowModeDefaults({ io: IO, mode: "T2I", paramMap: PARAM_MAP });
    expect(out.megapixels).toBe("2");
    expect(out.multiple).toBe("64");
    expect(out.resolution).toBe("");
  });
});
