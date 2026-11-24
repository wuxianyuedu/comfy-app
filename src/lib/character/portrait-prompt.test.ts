/**
 * 角色立绘提示词用例（ISSUE #5009）：描述原文透传 + 立绘约束、负向词恒定。
 */
import { describe, expect, it } from "vitest";

import { PORTRAIT_NEGATIVE_PROMPT, buildPortraitPrompt } from "./portrait-prompt";

describe("buildPortraitPrompt", () => {
  it("原型 + 名字 + 描述 + 立绘约束按序拼接", () => {
    const prompt = buildPortraitPrompt({
      name: "樱井小樱",
      archetype: "魔法少女",
      description: "樱井小樱是一位十七岁的魔法少女。她有一头粉色的短发。",
    });
    expect(prompt).toContain("魔法少女");
    expect(prompt).toContain("樱井小樱");
    expect(prompt).toContain("她有一头粉色的短发。");
    expect(prompt).toContain("单人角色立绘");
  });

  it("缺名字 / 原型时不产生空句", () => {
    const prompt = buildPortraitPrompt({ description: "银发红瞳的猫娘。" });
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("null");
    expect(prompt.startsWith("银发红瞳的猫娘。")).toBe(true);
  });

  it("负向提示词是固定词表（低质 / 多肢 / 文字水印一族）", () => {
    expect(PORTRAIT_NEGATIVE_PROMPT).toContain("低质量");
    expect(PORTRAIT_NEGATIVE_PROMPT).toContain("多余肢体");
    expect(PORTRAIT_NEGATIVE_PROMPT).toContain("水印");
  });
});
