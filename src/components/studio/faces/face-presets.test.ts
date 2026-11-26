/**
 * 角色脸库预设的纯口径用例（规范 11 §11.1 单元测试层）：
 * 数据是 PRESET 数组，新增一条不该破坏搜索 / 拼接；这里钉形状与拼接口径。
 */
import { describe, expect, it } from "vitest";

import {
  buildFaceNegative,
  buildFacePrompt,
  FACE_CLOSEUP_PREFIX,
  FACE_PRESETS,
  findFacePreset,
  searchFacePresets,
} from "./face-presets";

describe("内置脸部形象预设（数据驱动）", () => {
  it("每条都有稳定 id、中文名 / 说明、非空提示词与标签", () => {
    const ids = FACE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of FACE_PRESETS) {
      expect(preset.name.trim()).not.toBe("");
      expect(preset.description.trim()).not.toBe("");
      expect(preset.prompt.trim()).not.toBe("");
      expect(preset.tags.length).toBeGreaterThan(0);
    }
  });

  it("按 id 反查；空 id 与不存在的 id 都回 null", () => {
    expect(findFacePreset("silver-mage")?.name).toBe("银发清新少女");
    expect(findFacePreset("")).toBeNull();
    expect(findFacePreset("not-exist")).toBeNull();
  });

  it("搜索按名字 / 说明 / 标签 / 提示词命中，空词回全部", () => {
    expect(searchFacePresets("", FACE_PRESETS)).toHaveLength(FACE_PRESETS.length);
    expect(searchFacePresets("蓝瞳", FACE_PRESETS).map((p) => p.id)).toContain("silver-mage");
    expect(searchFacePresets("精灵耳", FACE_PRESETS).map((p) => p.id)).toEqual(["green-elf"]);
    expect(searchFacePresets("crimson iris", FACE_PRESETS).map((p) => p.id)).toEqual(["red-demon"]);
    expect(searchFacePresets("没有这张脸", FACE_PRESETS)).toEqual([]);
  });
});

describe("提示词拼接口径", () => {
  it("正向 = 脸部特写前缀 + 预设 + 立绘的唯一「无文字」约束", () => {
    const preset = findFacePreset("silver-mage");
    if (preset === null) {
      throw new Error("缺预设");
    }
    const prompt = buildFacePrompt(preset);
    expect(prompt.startsWith(FACE_CLOSEUP_PREFIX)).toBe(true);
    expect(prompt).toContain(preset.prompt);
    expect(prompt).toContain("除了角色服饰上的装饰文字以外");
  });

  it("负向沿用立绘唯一口径（不含「文字」，别连服饰装饰字一起禁掉）", () => {
    const negative = buildFaceNegative();
    expect(negative).toContain("低质量");
    expect(negative).not.toContain("文字");
  });
});
