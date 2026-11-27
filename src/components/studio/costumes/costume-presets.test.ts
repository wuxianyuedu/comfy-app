/**
 * 服饰库配置层的行为契约（规范 11 §11.2）：数量 / id 唯一 / 搜索 / 拼接口径。
 */
import { describe, expect, it } from "vitest";

import {
  buildCostumeNegative,
  buildCostumePrompt,
  COSTUME_PRESETS,
  findCostumePreset,
  searchCostumePresets,
} from "./costume-presets";

describe("服饰库预设（ISSUE #5125）", () => {
  it("内置 108 条，id 全库唯一且字段齐全", () => {
    expect(COSTUME_PRESETS).toHaveLength(108);
    expect(new Set(COSTUME_PRESETS.map((preset) => preset.id)).size).toBe(108);
    for (const preset of COSTUME_PRESETS) {
      expect(preset.id).not.toBe("");
      expect(preset.name).not.toBe("");
      expect(preset.description).not.toBe("");
      expect(preset.prompt).not.toBe("");
      expect(preset.tags.length).toBeGreaterThan(0);
    }
  });

  it("搜索命中中文说明 / 标签 / 英文提示词，空查询返回全部", () => {
    expect(searchCostumePresets("")).toHaveLength(108);
    expect(searchCostumePresets("旗袍").map((preset) => preset.id)).toContain("qipao-shanghai");
    expect(searchCostumePresets("赛博").map((preset) => preset.id)).toContain("fantasy-cyberpunk");
    expect(searchCostumePresets("Wizard").map((preset) => preset.id)).toContain(
      "fantasy-wizard-robe",
    );
    expect(searchCostumePresets("不存在的服饰")).toHaveLength(0);
  });

  it("findCostumePreset 只认真 id", () => {
    expect(findCostumePreset("tang-qixiong-ruqun")?.name).toBe("齐胸襦裙");
    expect(findCostumePreset("")).toBeNull();
  });

  it("提示词带全身前缀与无文字约束，负向沿用立绘唯一口径", () => {
    const preset = findCostumePreset("modern-trench");
    expect(preset).not.toBeNull();
    const prompt = buildCostumePrompt(preset!);
    expect(prompt).toContain("anime character full body");
    expect(prompt).toContain(preset!.prompt);
    expect(prompt).toContain("除了角色服饰上的装饰文字以外");
    expect(buildCostumeNegative()).toContain("低质量");
    expect(buildCostumeNegative()).not.toContain("文字");
  });
});
