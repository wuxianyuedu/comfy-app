/* 统一对外参数契约（按模式，与工作流无关）—— ISSUE #355 复审
 *
 * 契约只认模式：文生图就给「提示词 + 尺寸」，单图生视频再给「首帧 + 尾帧」，
 * 首尾帧模式才给「尾帧」。工作流里碰巧叫什么名字（text / value_1 /
 * resolution_preset…）不参与决定「对外有哪些参数」。 */

import { describe, expect, it } from "vitest";

import { familyOfClass } from "./workflow-param-classes";
import {
  exposedClassOf,
  exposedParamLabel,
  exposedParamsForMode,
  isVideoMode,
  modeUsesFirstFrame,
  modeUsesLastFrame,
} from "./workflow-exposed-params";

function ids(mode: string | null): Array<string> {
  return exposedParamsForMode(mode).map((def) => def.id);
}

describe("exposedParamsForMode", () => {
  it("文生图只保留提示词与尺寸（+ 种子口）", () => {
    expect(ids("T2I")).toEqual(["prompt", "negative", "size", "seed"]);
  });

  it("图生图额外给参考图（输入本身就是一张图；默认 1 槽，编辑器里可继续追加）", () => {
    expect(ids("I2I")).toEqual(["prompt", "negative", "reference-image", "size", "seed"]);
  });

  it("姿态骨架生图默认两张参考图槽（基线 JSON 的口径）", () => {
    expect(ids("P2I")).toEqual([
      "prompt",
      "negative",
      "reference-image",
      "reference-image-2",
      "size",
      "seed",
    ]);
  });

  it("单图生视频给首帧与尾帧；视频口都带时长", () => {
    expect(ids("I2V")).toEqual([
      "prompt",
      "negative",
      "first-frame",
      "last-frame",
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
    expect(ids("T2V")).toEqual(["prompt", "negative", "size", "duration", "seed"]);
  });

  it("参考图生视频走参考图口，不给首帧口", () => {
    expect(ids("R2V")).toEqual([
      "prompt",
      "negative",
      "reference-image",
      "size",
      "duration",
      "seed",
    ]);
  });

  it("音频生成三档（T2A / T2M / T2S）不带尺寸口", () => {
    expect(ids("T2A")).toEqual(["prompt", "negative", "seed"]);
    expect(ids("T2M")).toEqual(["prompt", "negative", "seed"]);
    expect(ids("T2S")).toEqual(["prompt", "negative", "seed"]);
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

describe("lora 契约口（FR-QA-02③ · #2622）", () => {
  it("默认契约不再带 lora 口（基线 JSON 已移除；作者可在契约编辑器里加回）", () => {
    for (const mode of ["T2I", "I2I", "T2V", null]) {
      const ids = exposedParamsForMode(mode).map((def) => def.id);
      expect(ids).not.toContain("lora-name");
      expect(ids).not.toContain("lora-strength");
    }
  });

  it("familyOfClass：lora-name 走 text 族、lora-strength 走 number 族", () => {
    expect(familyOfClass("lora-name")).toBe("text");
    expect(familyOfClass("lora-strength")).toBe("number");
  });
});

describe("音视频档模式码（*VA，#4999）", () => {
  it("三个 *VA 码都判为视频生成，走视频通道", () => {
    expect(isVideoMode("T2VA")).toBe(true);
    expect(isVideoMode("flf2va")).toBe(true);
    expect(isVideoMode("R2VA")).toBe(true);
    expect(isVideoMode("T2I")).toBe(false);
  });

  it("首尾帧 / 参考图的口判定与各自的视频姊妹档一致", () => {
    expect(modeUsesFirstFrame("FLF2VA")).toBe(true);
    expect(modeUsesLastFrame("FLF2VA")).toBe(true);
    /* R2VA 走参考图口，不占首帧口（与 R2V 同口径）。 */
    expect(modeUsesFirstFrame("R2VA")).toBe(false);
    expect(modeUsesLastFrame("R2VA")).toBe(false);
    expect(modeUsesFirstFrame("T2VA")).toBe(false);
    expect(modeUsesLastFrame("T2VA")).toBe(false);
  });
});
