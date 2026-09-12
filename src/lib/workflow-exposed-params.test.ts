/* 统一对外参数契约（按模式，与工作流无关）—— ISSUE #355 复审
 *
 * 契约只认模式：文生图就给「提示词 + 尺寸」，单图生视频再给「首帧」，首尾帧模式
 * 才给「尾帧」。工作流里碰巧叫什么名字（text / value_1 / resolution_preset…）
 * 不参与决定「对外有哪些参数」。 */

import { describe, expect, it } from "vitest";

import {
  exposedClassOf,
  exposedParamLabel,
  exposedParamsForMode,
} from "./workflow-exposed-params";

function ids(mode: string | null): string[] {
  return exposedParamsForMode(mode).map((def) => def.id);
}

describe("exposedParamsForMode", () => {
  it("文生图只保留提示词与尺寸", () => {
    expect(ids("T2I")).toEqual(["prompt", "negative", "size"]);
  });

  it("图生图额外给参考图（输入本身就是一张图）", () => {
    expect(ids("I2I")).toEqual([
      "prompt",
      "negative",
      "reference-image",
      "reference-image-2",
      "size",
    ]);
  });

  it("单图生视频给首帧，不给尾帧", () => {
    expect(ids("I2V")).toEqual(["prompt", "negative", "first-frame", "size"]);
  });

  it("首尾帧模式才给尾帧", () => {
    expect(ids("FLF2V")).toEqual([
      "prompt",
      "negative",
      "first-frame",
      "last-frame",
      "size",
    ]);
  });

  it("文生视频不给首帧（没有图可给）", () => {
    expect(ids("T2V")).toEqual(["prompt", "negative", "size"]);
  });

  it("没有模式时退到最保守的一套（提示词 + 尺寸）", () => {
    expect(ids(null)).toEqual(["prompt", "negative", "size"]);
    expect(ids("")).toEqual(["prompt", "negative", "size"]);
  });

  it("负面提示词是可选口子：工作流没有对应端口时不摆出来", () => {
    const negative = exposedParamsForMode("T2I").find(
      (def) => def.id === "negative",
    );
    expect(negative?.optional).toBe(true);
  });
});

describe("exposedParamLabel / exposedClassOf", () => {
  it("统一参数名与模式无关", () => {
    expect(exposedParamLabel("prompt")).toBe("提示词");
    expect(exposedParamLabel("size")).toBe("尺寸");
    /* 未知键原样返回（兼容历史落库键）。 */
    expect(exposedParamLabel("5|size-width")).toBe("5|size-width");
  });

  it("带序号的参考图口归到同一类", () => {
    expect(exposedClassOf("reference-image")).toBe("reference-image");
    expect(exposedClassOf("reference-image-2")).toBe("reference-image");
    expect(exposedClassOf("steps")).toBeNull();
  });
});
