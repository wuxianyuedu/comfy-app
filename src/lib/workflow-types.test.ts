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
  it("trim + 大写后按别名映射", () => {
    // 实现语义：trim().toUpperCase() 后查 LEGACY_TYPE_ALIASES，命中返回规范 code
    expect(normalizeTaskType("  TXT2IMG ")).toBe("T2I");
    expect(normalizeTaskType("  txt2img ")).toBe("T2I");
  });

  it("空值原样返回（无回退）", () => {
    expect(normalizeTaskType("")).toBe("");
  });

  it("未知类型保持原样", () => {
    expect(normalizeTaskType("custom-xyz")).toBe("custom-xyz");
  });
});
