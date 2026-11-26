/**
 * 角色立绘提示词用例（ISSUE #5009）：描述原文透传 + 立绘约束、负向词恒定。
 * 名字 / 原型**不进**提示词（模型会把它们画成画面文字）。
 * 两套形状互斥：接负向词的走词表，不接的把文字约束折成正向前缀。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PORTRAIT_NEGATIVE_PROMPT,
  PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE,
  buildPortraitPrompt,
  buildPortraitPrompts,
} from "./portrait-prompt";

describe("buildPortraitPrompt", () => {
  it("名字与原型不进提示词（避免被画成画面文字），描述保留", () => {
    const prompt = buildPortraitPrompt({
      name: "樱井小樱",
      archetype: "魔法少女",
      description: "樱井小樱是一位十七岁的魔法少女。她有一头粉色的短发。",
    });
    expect(prompt).not.toContain("樱井小樱");
    expect(prompt).not.toContain("魔法少女，");
    expect(prompt).toContain("她有一头粉色的短发。");
    expect(prompt).toContain("单人角色立绘");
  });

  it("名字从描述里剥掉后不留残渣（标点收拢）", () => {
    const prompt = buildPortraitPrompt({
      name: "千堂景",
      description: "千堂景是一名猎人。千堂景擅长追踪。",
    });
    expect(prompt).not.toContain("千堂景");
    expect(prompt).toContain("是一名猎人。擅长追踪。");
  });

  it("缺名字 / 原型时不产生空句", () => {
    const prompt = buildPortraitPrompt({ description: "银发红瞳的猫娘。" });
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("null");
    expect(prompt.startsWith("银发红瞳的猫娘。")).toBe(true);
  });

  it("负向提示词只压低质 / 多肢，不写「文字」（否则连服饰装饰文字都被禁掉）", () => {
    expect(PORTRAIT_NEGATIVE_PROMPT).toContain("低质量");
    expect(PORTRAIT_NEGATIVE_PROMPT).toContain("多余肢体");
    expect(PORTRAIT_NEGATIVE_PROMPT).not.toContain("文字");
    expect(PORTRAIT_NEGATIVE_PROMPT).not.toContain("水印");
  });
});

describe("buildPortraitPrompts —— 两套互斥的提示词", () => {
  const character = {
    name: "樱井小樱",
    archetype: "魔法少女",
    description: "樱井小樱是一位十七岁的魔法少女。她有一头粉色的短发。",
  };

  it("支持负向词：两态都带服饰文字例外句，负向只压低质 / 多肢", () => {
    const result = buildPortraitPrompts(character, true);
    expect(result.prompt).toContain("单人角色立绘");
    expect(result.prompt).toContain(PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE);
    expect(result.prompt).not.toContain("画面中不出现任何文字");
    expect(result.negativePrompt).toContain("低质量");
    expect(result.negativePrompt).not.toContain("文字");
  });

  it("不支持负向词：负向为空，文字约束以正向表述附在末尾（保留服饰文字例外）", () => {
    const result = buildPortraitPrompts(character, false);
    expect(result.negativePrompt).toBeNull();
    expect(result.prompt).toContain(PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE);
    expect(result.prompt).toContain("除了角色服饰上的装饰文字");
    expect(result.prompt).not.toContain("画面中不出现任何文字");
    expect(result.prompt).toContain("单人角色立绘");
  });

  it("两套都不把名字 / 原型写进提示词", () => {
    for (const supportsNegative of [true, false]) {
      const { prompt } = buildPortraitPrompts(character, supportsNegative);
      expect(prompt).not.toContain("樱井小樱");
      expect(prompt).not.toContain("魔法少女，");
      expect(prompt).toContain("她有一头粉色的短发。");
    }
  });
});

/* ISSUE #5085：被导出函数签名引用的类型必须导出，否则 typedoc 报
 * 「referenced but not included」warning，API 文档自检把任何 warning 判红。 */
describe("API 文档契约（ISSUE #5085）", () => {
  it("PortraitCharacter 已导出，typedoc 能收进文档", () => {
    const source = readFileSync("src/lib/character/portrait-prompt.ts", "utf8");
    expect(source).toMatch(/export type PortraitCharacter\s*=/);
  });
});
