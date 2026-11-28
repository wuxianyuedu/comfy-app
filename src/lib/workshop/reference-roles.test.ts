/**
 * 参考图职责化（ISSUE #5298）：职责归一、槽位对照与表演/镜头参考合并的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import {
  MAX_REFERENCE_IMAGES,
  normalizeReferenceRoles,
  orderedReferences,
  referenceRoleAnnotation,
  referenceRoleOf,
} from "./reference-roles";

describe("referenceRoleOf / normalizeReferenceRoles", () => {
  it("只认五个职责，其它一律 identity（老草稿不破）", () => {
    expect(referenceRoleOf("texture")).toBe("texture");
    expect(referenceRoleOf("evil")).toBe("identity");
    expect(referenceRoleOf(undefined)).toBe("identity");
    expect(normalizeReferenceRoles(["texture", "bad"], 3)).toEqual([
      "texture",
      "identity",
      "identity",
    ]);
  });

  it("超出 16 张按上限截断", () => {
    expect(normalizeReferenceRoles(Array(20).fill("prop"), 20)).toHaveLength(MAX_REFERENCE_IMAGES);
  });
});

describe("referenceRoleAnnotation", () => {
  it("给出槽位 ↔ 职责 ↔ 图片编号的可读对照", () => {
    expect(referenceRoleAnnotation(["identity", "texture"])).toBe(
      "@image_1=identity, @image_2=texture",
    );
    expect(referenceRoleAnnotation([])).toBe("");
  });
});

describe("orderedReferences", () => {
  it("表演参考在前按 identity，镜头参考逐槽带职责，空地址跳过", () => {
    const result = orderedReferences({
      performance: ["acting.mp4"],
      shotImages: ["face.png", "", "bg.png"],
      shotRoles: ["identity", "identity", "background"],
    });
    expect(result).toEqual([
      { role: "identity", url: "acting.mp4" },
      { role: "identity", url: "face.png" },
      { role: "background", url: "bg.png" },
    ]);
  });

  it("没有镜头职责时全按 identity", () => {
    expect(orderedReferences({ shotImages: ["a.png"] })).toEqual([
      { role: "identity", url: "a.png" },
    ]);
  });
});
