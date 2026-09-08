import { describe, it, expect } from "vitest";
import {
  ALL_WORKFLOW_TYPES,
  IMAGE_WORKFLOW_TYPES,
  VIDEO_WORKFLOW_TYPES,
  AUDIO_WORKFLOW_TYPES,
  getWorkflowType,
  normalizeTaskType,
  getWorkflowTypesByCategory,
} from "./workflow-types";

describe("workflow-types taxonomy", () => {
  it("合并列表与三大分类数量一致", () => {
    const union = [
      ...IMAGE_WORKFLOW_TYPES,
      ...VIDEO_WORKFLOW_TYPES,
      ...AUDIO_WORKFLOW_TYPES,
    ];
    expect(union.length).toBe(ALL_WORKFLOW_TYPES.length);
    expect(ALL_WORKFLOW_TYPES.length).toBeGreaterThan(0);
  });

  it("每个类型都有唯一 code", () => {
    const codes = ALL_WORKFLOW_TYPES.map((wfType) => wfType.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("getWorkflowType 按 code 精确命中", () => {
    const type = getWorkflowType(IMAGE_WORKFLOW_TYPES[0]!.code);
    expect(type?.code).toBe(IMAGE_WORKFLOW_TYPES[0]!.code);
    expect(getWorkflowType("no-such-code")).toBeUndefined();
  });

  it("getWorkflowTypesByCategory 只返回该分类", () => {
    const imgs = getWorkflowTypesByCategory("image");
    expect(imgs.length).toBe(IMAGE_WORKFLOW_TYPES.length);
    expect(imgs.every((item) => item.category === "image")).toBe(true);
  });
});

describe("normalizeTaskType", () => {
  it("规范 code 输入大小写不敏感归一到规范大小写", () => {
    // 规范 code 为全大写（T2I / I2V …）或混合大小写（Inpaint / Upscale）
    expect(normalizeTaskType("  T2I ")).toBe("T2I");
    expect(normalizeTaskType("t2i")).toBe("T2I");
    expect(normalizeTaskType("i2v")).toBe("I2V");
    expect(normalizeTaskType("inpaint")).toBe("Inpaint");
    expect(normalizeTaskType("INPAINT")).toBe("Inpaint");
    expect(normalizeTaskType("upscale")).toBe("Upscale");
  });

  it("历史旧别名不再被映射（放弃存量兼容，按自定义值透传）", () => {
    // 已删除 TXT2IMG→T2I 等 legacy 映射；旧码不再规整到规范 code
    expect(normalizeTaskType("TXT2IMG")).toBe("TXT2IMG");
    expect(normalizeTaskType("  txt2img ")).toBe("txt2img");
    expect(normalizeTaskType("IMG2IMG")).toBe("IMG2IMG");
  });

  it("空值原样返回（无回退）", () => {
    expect(normalizeTaskType("")).toBe("");
    expect(normalizeTaskType("   ")).toBe("");
  });

  it("未知/自定义类型 trim 后原样透传", () => {
    expect(normalizeTaskType("custom-xyz")).toBe("custom-xyz");
    expect(normalizeTaskType("  custom-xyz ")).toBe("custom-xyz");
  });
});
