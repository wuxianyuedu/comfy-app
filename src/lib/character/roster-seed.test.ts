/**
 * 角色预置生成器用例（ISSUE #5009）：确定性（同种子逐字一致）、数量与去重、
 * 描述的信息密度、标签必然被提出、性别与名字池一致。
 */
import { describe, expect, it } from "vitest";

import { generateCharacterRoster, ROSTER_COUNT_MAX } from "./roster-seed";

describe("generateCharacterRoster —— 确定性与规模", () => {
  it("同一种子跑两遍，结果逐字一致（可复现）", () => {
    const a = generateCharacterRoster({ count: 20, seed: 42 });
    const b = generateCharacterRoster({ count: 20, seed: 42 });
    expect(a).toEqual(b);
  });

  it("不同种子产出不同的角色", () => {
    const a = generateCharacterRoster({ count: 20, seed: 42 });
    const b = generateCharacterRoster({ count: 20, seed: 43 });
    expect(a).not.toEqual(b);
  });

  it("按数量产出；同一批内名字唯一；上限收口到 1000", () => {
    const roster = generateCharacterRoster({ count: 120, seed: 7 });
    expect(roster).toHaveLength(120);
    expect(new Set(roster.map((entry) => entry.name)).size).toBe(120);

    const capped = generateCharacterRoster({ count: 99_999, seed: 7 });
    expect(capped).toHaveLength(ROSTER_COUNT_MAX);
  });

  it("count 收口到下限 1，不产空批", () => {
    expect(generateCharacterRoster({ count: 0, seed: 1 })).toHaveLength(1);
    expect(generateCharacterRoster({ count: -5, seed: 1 })).toHaveLength(1);
  });
});

describe("generateCharacterRoster —— 档案质量", () => {
  const roster = generateCharacterRoster({ count: 300, seed: 20_261_125 });

  it("每个角色都有非空的名字 / 原型 / 性别 / 描述", () => {
    for (const entry of roster) {
      expect(entry.name).not.toBe("");
      expect(entry.archetype).not.toBe("");
      expect(["女", "男"]).toContain(entry.gender);
      expect(entry.description.length).toBeGreaterThanOrEqual(80);
    }
  });

  it("描述包含名字与原型（描述自含身份，生图提示词可直接引用）", () => {
    for (const entry of roster.slice(0, 50)) {
      expect(entry.description).toContain(entry.name);
      expect(entry.description).toContain(entry.archetype);
    }
  });

  it("每个角色都从描述里提出了至少 3 枚特征标签", () => {
    for (const entry of roster) {
      expect(entry.tags.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("原型种类足够多（选角场景要求覆盖面），300 个里 ≥ 20 种原型", () => {
    expect(new Set(roster.map((entry) => entry.archetype)).size).toBeGreaterThanOrEqual(20);
  });

  it("性别与描述代词一致（她 / 他跟随性别字段）", () => {
    for (const entry of roster.slice(0, 60)) {
      const pronoun = entry.gender === "女" ? "她" : "他";
      expect(entry.description).toContain(pronoun);
    }
  });
});
