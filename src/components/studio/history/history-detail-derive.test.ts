// 历史详情弹窗的派生规则单测：纯函数，无需 render、无需网络。
// 这些规则原先内联在 JSX 的 IIFE 里（R-ardot60/62/63），改一行没人知道有没有回归。

import { describe, expect, it } from "vitest";

import {
  deriveGenValues,
  deriveParamRows,
  derivePrompt,
  toWorkflowHints,
  workflowInputsOf,
} from "./history-detail-derive";
import type { TaskDetail } from "./history-types";

/** 只造测试关心的字段：TaskDetail 很大，其余字段用 unknown 兜。 */
function makeDetail(params: unknown, extra: Partial<TaskDetail> = {}): TaskDetail {
  return { id: "t-1", params, images: [], ...extra } as unknown as TaskDetail;
}

describe("toWorkflowHints", () => {
  it("非对象回落为空对象（父组件未传或传 null 时按「无提示」处理）", () => {
    expect(toWorkflowHints(null)).toEqual({});
    expect(toWorkflowHints(undefined)).toEqual({});
    expect(toWorkflowHints("x")).toEqual({});
  });

  it("对象原样返回", () => {
    expect(toWorkflowHints({ steps: 20 })).toEqual({ steps: 20 });
  });
});

describe("workflowInputsOf", () => {
  it("非数组回落为空数组", () => {
    expect(workflowInputsOf(makeDetail({ workflowInputs: "nope" }))).toEqual([]);
    expect(workflowInputsOf(makeDetail(null))).toEqual([]);
  });
});

describe("derivePrompt", () => {
  it("顶层 prompt 非空时优先于 workflowInputs 兜底", () => {
    const d = makeDetail(
      { workflowInputs: [{ name: "text", value: "来自 inputs" }] },
      { prompt: "顶层" },
    );
    expect(derivePrompt(d).prompt).toBe("顶层");
  });

  it("R-ardot60：顶层为空时回落到 workflowInputs 的 text/prompt/positive", () => {
    for (const name of ["text", "prompt", "positive"]) {
      const d = makeDetail({ workflowInputs: [{ name, value: "回填提示词" }] });
      expect(derivePrompt(d).prompt).toBe("回填提示词");
    }
  });

  it("inputs 命中但值非字符串时不回落", () => {
    const d = makeDetail({ workflowInputs: [{ name: "text", value: 42 }] });
    expect(derivePrompt(d).prompt).toBe("");
    expect(derivePrompt(d).showPrompt).toBe(false);
  });

  it("无提示词时 showPrompt 为 false（视图不渲染空区块）", () => {
    expect(derivePrompt(makeDetail({})).showPrompt).toBe(false);
  });
});

describe("deriveGenValues", () => {
  it("无详情返回空数组", () => {
    expect(deriveGenValues(null, null)).toEqual([]);
  });

  it("顶层 params 命中（steps/cfg）", () => {
    const d = makeDetail({ steps: 30, cfg: 7.5 });
    expect(deriveGenValues(d, null)).toEqual([
      { label: "步数", value: 30, hint: undefined },
      { label: "CFG", value: 7.5, hint: undefined },
    ]);
  });

  it("顶层缺失时回落到 workflowInputs（按 name 小写匹配）", () => {
    const d = makeDetail({
      workflowInputs: [{ name: "Sampler_name", value: "euler" }],
    });
    expect(deriveGenValues(d, null)).toEqual([{ label: "采样器", value: "euler" }]);
  });

  it("R-ardot63：再回落到 workflowHints（工作流硬编码的节点默认值）", () => {
    const d = makeDetail({});
    const values = deriveGenValues(d, { steps: 20, cfg: 8, sampler_name: "dpmpp_2m" });
    expect(values).toEqual([
      { label: "步数", value: 20, hint: undefined },
      { label: "CFG", value: 8, hint: undefined },
      { label: "采样器", value: "dpmpp_2m", hint: undefined },
    ]);
  });

  it("空白值（空串 / null / undefined）视为未命中，继续找下一个源", () => {
    const d = makeDetail({ steps: "", cfg: null });
    const values = deriveGenValues(d, { steps: 20 });
    expect(values.find((v) => v.label === "步数")?.value).toBe(20);
    expect(values.find((v) => v.label === "CFG")).toBeUndefined();
  });

  it("尺寸优先取 workflowHints 的 width×height，缺失时用封面图尺寸", () => {
    const withHints = makeDetail({});
    expect(deriveGenValues(withHints, { width: 1024, height: 768 })).toEqual([
      { label: "尺寸", value: "1024×768", hint: undefined },
    ]);
    const withCover = makeDetail({}, {
      images: [{ width: 512, height: 512, isCover: true }],
    } as unknown as Partial<TaskDetail>);
    expect(deriveGenValues(withCover, null)).toEqual([
      { label: "尺寸", value: "512×512", hint: undefined },
    ]);
  });

  it("R-ardot62：seed 来源决定 hint，区分真值 / 用户填值", () => {
    const d = makeDetail({});
    expect(deriveGenValues(d, { seed: 12345, seedSource: "history" })[0]).toEqual({
      label: "种子",
      value: 12345,
      hint: "本次执行真实使用值",
    });
    expect(deriveGenValues(d, { seed: 12345, seedSource: "request" })[0]).toEqual({
      label: "种子",
      value: 12345,
      hint: "用户提交时填写的 seed",
    });
    expect(deriveGenValues(d, { seed: 12345 })[0]).toEqual({
      label: "种子",
      value: 12345,
      hint: undefined,
    });
  });

  it("同 label 多个候选键只取一次（seed / noise_seed / image_seed 不重复出卡）", () => {
    const d = makeDetail({ seed: 1, noise_seed: 2, image_seed: 3 });
    expect(deriveGenValues(d, null).filter((v) => v.label === "种子")).toHaveLength(1);
  });
});

describe("deriveParamRows", () => {
  it("过滤掉已在生成参数卡展示的键，避免两处重复", () => {
    const d = makeDetail({
      workflowInputs: [
        { nodeId: "3", name: "seed", value: 1 },
        { nodeId: "4", name: "prefix", value: "a photo of" },
      ],
    });
    const { rows, hasAny } = deriveParamRows(d);
    expect(rows.map((r) => r.name)).toEqual(["prefix"]);
    expect(hasAny).toBe(true);
  });

  it("顶层条目排除 workflowInputs 本身", () => {
    const d = makeDetail({ lora: "x.safetensors", workflowInputs: [] });
    expect(deriveParamRows(d).topLevelEntries).toEqual([["lora", "x.safetensors"]]);
  });

  it("无参数时 hasAny 为 false（视图不渲染空参数区块）", () => {
    expect(deriveParamRows(makeDetail({})).hasAny).toBe(false);
  });
});
