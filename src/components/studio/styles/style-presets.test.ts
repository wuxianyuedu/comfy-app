/**
 * 风格库预设的纯口径用例（规范 11 §11.1 单元测试层）：
 * 预设是数据驱动的，新增一条不该破坏既有拼接；这里钉住形状与拼接规则。
 */
import { describe, expect, it } from "vitest";

import {
  ANIME_CHARACTER_PRESETS,
  applyStyleTemplate,
  composeBasePrompt,
  composeNegativePrompt,
  findPreset,
  SCENE_PRESETS,
} from "./style-presets";

describe("内置角色 / 场景预设（数据驱动）", () => {
  it.for([ANIME_CHARACTER_PRESETS, SCENE_PRESETS])("每条都有稳定 id、名字与非空描述", (presets) => {
    const ids = presets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of presets) {
      expect(preset.name.trim()).not.toBe("");
      expect(preset.description.trim()).not.toBe("");
      expect(preset.tags.length).toBeGreaterThan(0);
    }
  });

  it("按 id 反查，空 id 与不存在的 id 都回 null", () => {
    expect(findPreset(ANIME_CHARACTER_PRESETS, "silver-mage")?.name).toBe("银发魔法少女");
    expect(findPreset(SCENE_PRESETS, "")).toBeNull();
    expect(findPreset(SCENE_PRESETS, "not-exist")).toBeNull();
  });
});

describe("提示词拼接", () => {
  it("基础提示词按用户输入 → 角色 → 场景的顺序拼，并去掉空白项", () => {
    expect(
      composeBasePrompt({
        character: " silver-haired girl ",
        scene: " cherry blossom ",
        userPrompt: "  standing  ",
      }),
    ).toBe("standing, silver-haired girl, cherry blossom");
    expect(composeBasePrompt({ userPrompt: "  only  " })).toBe("only");
  });

  it("画风模板含 {subject} 时替换它，否则作为后缀（与 prompt-builder 同口径）", () => {
    const base = "girl in park";
    expect(applyStyleTemplate(base, "anime style, {subject}, soft light")).toBe(
      "anime style, girl in park, soft light",
    );
    expect(applyStyleTemplate(base, "oil painting, thick brush")).toBe(
      "girl in park, oil painting, thick brush",
    );
    expect(applyStyleTemplate(base, "  ")).toBe(base);
    expect(applyStyleTemplate("", "anime style")).toBe("anime style");
  });

  it("负向词去重且保序，空项不进结果", () => {
    expect(composeNegativePrompt("ugly, blurry", "blurry, low quality")).toBe(
      "ugly, blurry, low quality",
    );
    expect(composeNegativePrompt("ugly", undefined)).toBe("ugly");
  });
});
