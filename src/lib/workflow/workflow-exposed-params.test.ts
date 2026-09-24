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
  it("文生图只保留提示词与尺寸（+ 种子口）", () => {
    expect(ids("T2I")).toEqual(["prompt", "negative", "size", "seed"]);
  });

  it("图生图额外给参考图（输入本身就是一张图）", () => {
    expect(ids("I2I")).toEqual([
      "prompt",
      "negative",
      "reference-image",
      "reference-image-2",
      "size",
      "seed",
    ]);
  });

  it("单图生视频给首帧，不给尾帧；视频口都带时长", () => {
    expect(ids("I2V")).toEqual([
      "prompt",
      "negative",
      "first-frame",
      "size",
      "duration",
      "seed",
    ]);
  });

  it("首尾帧模式才给尾帧", () => {
    expect(ids("FLF2V")).toEqual([
      "prompt",
      "negative",
      "first-frame",
      "last-frame",
      "size",
      "duration",
      "seed",
    ]);
  });

  it("文生视频不给首帧（没有图可给），但有时长", () => {
    expect(ids("T2V")).toEqual([
      "prompt",
      "negative",
      "size",
      "duration",
      "seed",
    ]);
  });

  it("时长是视频专有口：生图模式不带", () => {
    expect(ids("T2I")).not.toContain("duration");
    expect(ids("I2I")).not.toContain("duration");
  });

  it("没有模式时退到最保守的一套（提示词 + 尺寸 + 种子）", () => {
    expect(ids(null)).toEqual(["prompt", "negative", "size", "seed"]);
    expect(ids("")).toEqual(["prompt", "negative", "size", "seed"]);
  });

  it("契约口一律常驻：没有 `optional` 这种「看工作流脸色」的标记", () => {
    /* 显示与否只由契约决定 —— 工作流能不能承接是**落点**问题，不是「这一口
     *  存不存在」的问题。契约表里因此不该有按工作流裁剪口子的字段。 */
    for (const def of exposedParamsForMode("T2I")) {
      expect(Object.keys(def)).not.toContain("optional");
    }
    expect(ids("T2I")).toEqual(["prompt", "negative", "size", "seed"]);
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
