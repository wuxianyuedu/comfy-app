/**
 * 内置技能种子的契约：扩充到 100+ 条后仍要保证 slug 唯一、画风种子字段齐备、
 * 且分类合法——仓储的 `ensureBuiltIns` 按 slug 补缺，撞号会让后到者静默丢数据。
 */
import { describe, expect, it } from "vitest";

import { BUILTIN_SKILLS, CATEGORY_LABELS } from "~/lib/skills-seed";

describe("内置技能种子（Skill 系统唯一出口）", () => {
  it("至少 100 条内置画风，slug 全库唯一", () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(100);
    const slugs = BUILTIN_SKILLS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("每条都有合法分类、中文名 / 说明与非空提示词模板", () => {
    for (const seed of BUILTIN_SKILLS) {
      expect(Object.keys(CATEGORY_LABELS)).toContain(seed.category);
      expect(seed.name.trim()).not.toBe("");
      expect(seed.description.trim()).not.toBe("");
      expect(seed.promptTemplate.trim()).not.toBe("");
      expect(seed.tags.length).toBeGreaterThan(0);
    }
  });

  it("日系动漫细分画风有 100+ 条，全部是 style 分类且 slug 带 anime- 前缀", () => {
    const anime = BUILTIN_SKILLS.filter((s) => s.slug.startsWith("anime-"));
    expect(anime.length).toBeGreaterThanOrEqual(100);
    expect(anime.every((s) => s.category === "style")).toBe(true);
  });

  it("既有代表模板仍在（不因扩充丢失）", () => {
    const slugs = new Set(BUILTIN_SKILLS.map((s) => s.slug));
    for (const slug of ["pixar-animation", "anime-illustration", "cyberpunk-city"]) {
      expect(slugs.has(slug)).toBe(true);
    }
  });
});
