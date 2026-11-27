/**
 * 装饰库配置层的行为契约（规范 11 §11.2）：数量 / id 唯一 / 搜索 / 拼接口径。
 */
import { describe, expect, it } from "vitest";

import {
  ACCESSORY_PRESETS,
  buildAccessoryNegative,
  buildAccessoryPrompt,
  findAccessoryPreset,
  searchAccessoryPresets,
} from "./accessory-presets";

describe("装饰库预设（ISSUE #5126）", () => {
  it("内置 108 条，id 全库唯一且字段齐全", () => {
    expect(ACCESSORY_PRESETS).toHaveLength(108);
    expect(new Set(ACCESSORY_PRESETS.map((preset) => preset.id)).size).toBe(108);
    for (const preset of ACCESSORY_PRESETS) {
      expect(preset.id).not.toBe("");
      expect(preset.name).not.toBe("");
      expect(preset.description).not.toBe("");
      expect(preset.prompt).not.toBe("");
      expect(preset.tags.length).toBeGreaterThan(0);
    }
  });

  it("搜索命中中文说明 / 标签 / 英文提示词，空查询返回全部", () => {
    expect(searchAccessoryPresets("")).toHaveLength(108);
    expect(searchAccessoryPresets("发簪").map((preset) => preset.id)).toContain("acc-jade-hairpin");
    expect(searchAccessoryPresets("魔法").map((preset) => preset.id)).toContain("acc-star-wand");
    expect(searchAccessoryPresets("crystal").map((preset) => preset.id)).toContain(
      "acc-crystal-ball",
    );
    expect(searchAccessoryPresets("不存在的装饰")).toHaveLength(0);
  });

  it("findAccessoryPreset 只认真 id", () => {
    expect(findAccessoryPreset("acc-phoenix-crown")?.name).toBe("凤冠");
    expect(findAccessoryPreset("")).toBeNull();
  });

  it("提示词带半身特写前缀与无文字约束，负向沿用立绘唯一口径", () => {
    const preset = findAccessoryPreset("acc-diamond-ring");
    expect(preset).not.toBeNull();
    const prompt = buildAccessoryPrompt(preset!);
    expect(prompt).toContain("anime character upper body");
    expect(prompt).toContain(preset!.prompt);
    expect(prompt).toContain("除了角色服饰上的装饰文字以外");
    expect(buildAccessoryNegative()).toContain("低质量");
    expect(buildAccessoryNegative()).not.toContain("文字");
  });
});
