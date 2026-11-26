/** 产物三级分类的取值判据：每一维都从库里已有的事实派生，且必须收成合法目录段。 */
import { describe, expect, it } from "vitest";

import { safeDirSegment, taxonomyFrom } from "./artifact-taxonomy";

describe("safeDirSegment", () => {
  it("保留中文、字母、数字与 . _ -，空格和 Windows 保留字符收成下划线", () => {
    expect(safeDirSegment("MiniMax H3 Image", "unknown")).toBe("MiniMax_H3_Image");
    expect(safeDirSegment("模型 /A:B*C?", "unknown")).toBe("模型_A_B_C");
    expect(safeDirSegment("a.b-c_d", "unknown")).toBe("a.b-c_d");
  });

  it("空串 / 全非法 / 只剩点 → 回落，绝不落空段", () => {
    expect(safeDirSegment("", "unknown")).toBe("unknown");
    expect(safeDirSegment("   ", "unknown")).toBe("unknown");
    expect(safeDirSegment("..", "unknown")).toBe("unknown");
    expect(safeDirSegment(null, "unknown")).toBe("unknown");
  });
});

describe("taxonomyFrom", () => {
  it("三维都给齐时逐项收口", () => {
    expect(taxonomyFrom({ mediaType: "image", modelName: "MiniMax H3", modeCode: "T2I" })).toEqual({
      mediaType: "image",
      modelName: "MiniMax_H3",
      modeCode: "T2I",
    });
  });

  it("模型名缺时回落工作流名，模式码缺时回落任务类型", () => {
    expect(taxonomyFrom({ mediaType: "video", workflowName: "图生视频", taskType: "I2V" })).toEqual(
      { mediaType: "video", modelName: "图生视频", modeCode: "I2V" },
    );
  });

  it("全缺时各维给稳定兜底，目录层级不会塌陷", () => {
    expect(taxonomyFrom({})).toEqual({
      mediaType: "image",
      modelName: "unknown",
      modeCode: "UNKNOWN",
    });
  });
});
