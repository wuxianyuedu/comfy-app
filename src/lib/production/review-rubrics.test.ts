// rubric 注册表单测（FR-QA-07 地基 · #2477）：三张量表的结构判据 —— 每张有版本号、
// 维度 key 唯一、每个维度 1~5 每档都有非空锚点。锚点缺失会让「模型该给几档」失去口径，
// 这里用穷举把形状钉死（数据文件回归）。
import { describe, expect, it } from "vitest";

import { REVIEW_RUBRICS, renderRubricForPrompt, rubricFor } from "./review-rubrics";

const KINDS = /* SAFETY: 类型断言已复核 */ ["script", "character", "shot", "shotImage"] as const;

describe("REVIEW_RUBRICS", () => {
  it("剧本 / 角色卡 / 分镜三张量表齐全，各带版本号", () => {
    for (const kind of KINDS) {
      const rubric = REVIEW_RUBRICS[kind];
      expect(rubric.kind).toBe(kind);
      expect(rubric.version).toMatch(new RegExp(`^${kind}-v\\d+$`));
      expect(rubric.dimensions.length).toBeGreaterThan(0);
    }
  });

  it("每个维度 key 唯一且非空（进 ReviewVerdict.scores 的键，定稿后不可改）", () => {
    for (const kind of KINDS) {
      const keys = REVIEW_RUBRICS[kind].dimensions.map((d) => d.key);
      expect(keys).toEqual([...new Set(keys)]);
      for (const key of keys) {
        expect(key.trim()).not.toBe("");
      }
    }
  });

  it("每个维度 1~5 每档都有非空锚点描述（收敛判据的口径面）", () => {
    for (const kind of KINDS) {
      for (const d of REVIEW_RUBRICS[kind].dimensions) {
        for (const score of /* SAFETY: 类型断言已复核 */ [1, 2, 3, 4, 5] as const) {
          expect(typeof d.anchors[score]).toBe("string");
          expect(d.anchors[score].trim()).not.toBe("");
        }
      }
    }
  });
});

describe("rubricFor", () => {
  it("按 kind 取表；未知 kind → null（不抛）", () => {
    expect(rubricFor("script")?.version).toBe(REVIEW_RUBRICS.script.version);
    expect(rubricFor("unknown")).toBeNull();
  });
});

describe("renderRubricForPrompt", () => {
  it("渲染出 key、标签与各档锚点；供提示词块拼接", () => {
    const text = renderRubricForPrompt(REVIEW_RUBRICS.shot);
    for (const d of REVIEW_RUBRICS.shot.dimensions) {
      expect(text).toContain(`（${d.key}）`);
      expect(text).toContain(d.label);
      expect(text).toContain(`1=${d.anchors[1]}`);
      expect(text).toContain(`5=${d.anchors[5]}`);
    }
  });

  it("无维度 → 空串（调用方据此省略该块）", () => {
    expect(renderRubricForPrompt({ kind: "shot", version: "x", dimensions: [] })).toBe("");
  });
});
