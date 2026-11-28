/**
 * 角色表演参考判据（ISSUE #5296）：提示词形状、生成条件与本镜角色锚点收集的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import {
  ACTING_CONSTRAINTS,
  needsPerformance,
  performancePromptOf,
  performanceRefsOf,
} from "./acting-reference";
import type { Character } from "./types";

const character = (over: Partial<Character> = {}): Character => ({
  ageGender: "",
  appearance: "白发，苍白肤色",
  costume: "黑色皮衣",
  id: "c1",
  name: "Adam",
  negativePrompt: "",
  params: {},
  personality: "冷静",
  positivePrompt: "",
  portraitUrl: "/api/generated/portrait.png",
  styleTags: [],
  temperament: "克制",
  ...over,
});

describe("performancePromptOf", () => {
  it("角色身份描述 + 固定表演约束，且不运镜不换装", () => {
    const prompt = performancePromptOf(character());
    expect(prompt).toContain("白发，苍白肤色");
    expect(prompt).toContain("黑色皮衣");
    for (const constraint of ACTING_CONSTRAINTS) {
      expect(prompt).toContain(constraint);
    }
    expect(prompt).toContain("no camera orbit");
    expect(prompt).toContain("no outfit changes");
  });
});

describe("needsPerformance", () => {
  it("有定妆照且没有表演参考才需要生成", () => {
    expect(needsPerformance(character())).toBe(true);
    expect(needsPerformance(character({ performanceUrl: "/api/generated/acting.mp4" }))).toBe(
      false,
    );
    expect(needsPerformance(character({ portraitUrl: undefined }))).toBe(false);
    expect(needsPerformance(character({ portraitUrl: "" }))).toBe(false);
  });
});

describe("performanceRefsOf", () => {
  it("只收本镜出场角色的表演参考，去重且只认字符串", () => {
    expect(
      performanceRefsOf(
        [
          { id: "c1", performanceUrl: "a.mp4" },
          { id: "c2", performanceUrl: "b.mp4" },
          { id: "c3", performanceUrl: 42 },
          null,
        ],
        ["c1", "c3"],
      ),
    ).toEqual(["a.mp4"]);
    expect(performanceRefsOf("x", ["c1"])).toEqual([]);
  });
});
