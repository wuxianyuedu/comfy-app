import { describe, expect, it } from "vitest";

import { compareText } from "~/lib/ordered-set";

import {
  DATA_LOCATION_CATEGORIES,
  DATA_LOCATIONS,
  isDataLocationCategory,
  isDataLocationId,
  listDataLocationGroups,
} from "./data-locations";

/**
 * 登记本体的形状判据（ISSUE #3625）。
 *
 * 这一层是**纯数据**，它红了的代价是「界面开始说谎」：徽标的图标取不到键就静默不画、
 * 落点写错就让人照着搬错文件。所以这里钉的是**不变量**，不是某个具体文案。
 */

/** 允许的徽标语义色（与 `ui/badge` 的 `tone` 轴同集合）。 */
const TONES = ["danger", "neutral", "primary", "success", "warning"];

describe("数据存放位置登记", () => {
  it("每个存放位置类别都有图标、名称与语义色", () => {
    for (const [category, info] of Object.entries(DATA_LOCATION_CATEGORIES)) {
      expect(info.icon, `${category} 缺图标键`).not.toBe("");
      expect(info.label, `${category} 缺类别名`).not.toBe("");
      expect(TONES, `${category} 的 tone 不在徽标语义色集合里`).toContain(info.tone);
    }
  });

  it("每个登记项都指向一个真实存在的类别，且三段文案都不是空串", () => {
    for (const [id, entry] of Object.entries(DATA_LOCATIONS)) {
      expect(Object.hasOwn(DATA_LOCATION_CATEGORIES, entry.category), `${id} 的类别未登记`).toBe(
        true,
      );
      expect(entry.kindLabel, `${id} 缺数据种类名`).not.toBe("");
      expect(entry.target, `${id} 缺落点`).not.toBe("");
      expect(entry.migration, `${id} 缺迁移办法`).not.toBe("");
    }
  });

  it("同一类数据的几份登记项共用同一个种类名（分组的依据）", () => {
    const labelsByKind = new Map<string, Set<string>>();
    for (const entry of Object.values(DATA_LOCATIONS)) {
      const seen = labelsByKind.get(entry.kind) ?? new Set<string>();
      seen.add(entry.kindLabel);
      labelsByKind.set(entry.kind, seen);
    }
    for (const [kind, labels] of labelsByKind) {
      expect([...labels], `${kind} 的种类名不止一个`).toHaveLength(1);
    }
  });

  it("分组结果把每一份登记项都收进来，且没有重复", () => {
    const groups = listDataLocationGroups();
    const grouped = groups.flatMap((group) => group.locations.map((one) => one.id));
    expect(grouped).toHaveLength(Object.keys(DATA_LOCATIONS).length);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(Object.keys(DATA_LOCATIONS).sort());
  });

  it("分组按种类名排序，组内按落点类别名排序", () => {
    const groups = listDataLocationGroups();
    const kindLabels = groups.map((group) => group.kindLabel);
    expect(kindLabels).toEqual([...kindLabels].sort(compareText));
    for (const group of groups) {
      const categoryLabels = group.locations.map(
        (one) => DATA_LOCATION_CATEGORIES[one.entry.category].label,
      );
      expect(categoryLabels).toEqual([...categoryLabels].sort(compareText));
    }
  });

  it("每类数据至少有一个存放位置（没有「说不清存在哪」的数据类）", () => {
    for (const group of listDataLocationGroups()) {
      expect(group.locations.length, `${group.kind} 没有登记任何存放位置`).toBeGreaterThan(0);
    }
  });

  it("类别表里的每一类都被至少一份登记项用上（没有空转的类别）", () => {
    const used = new Set(Object.values(DATA_LOCATIONS).map((entry) => entry.category));
    for (const category of Object.keys(DATA_LOCATION_CATEGORIES).filter(isDataLocationCategory)) {
      expect(used.has(category), `${category} 这一类没有任何数据在用`).toBe(true);
    }
  });

  it("登记项的 id 就是它在登记本体里的键（读侧按 id 取，取不到就红）", () => {
    for (const id of Object.keys(DATA_LOCATIONS).filter(isDataLocationId)) {
      expect(DATA_LOCATIONS[id], `${id} 取不到登记项`).toBeDefined();
    }
  });
});
