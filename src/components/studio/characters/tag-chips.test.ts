/**
 * tag-chips 派生计算回归（ISSUE #5203）：一次建 Map 取代逐标签线性 find。
 * 用例覆盖展示集合（前 N facet ∪ 已选中）、计数命中、排序与大规模 facet 下的正确性。
 */
import { describe, expect, it } from "vitest";

import { buildTagChips, TAG_FILTER_LIMIT, type TagFacet } from "./tag-chips";

/** 旧实现的同义参考，用来对照新实现的输出逐字一致。 */
function buildTagChipsLegacy(
  tagFacets: ReadonlyArray<TagFacet>,
  selectedTags: ReadonlyArray<string>,
) {
  const names = new Set<string>(selectedTags);
  for (const facet of tagFacets.slice(0, TAG_FILTER_LIMIT)) {
    names.add(facet.tag);
  }
  const countOf = (tag: string) => tagFacets.find((facet) => facet.tag === tag)?.count ?? 0;
  return [...names]
    .map((tag) => ({ count: countOf(tag), tag }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
}

describe("buildTagChips 标签筛选行派生计算（ISSUE #5203）", () => {
  it("展示集合 = 前 N 个 facet ∪ 已选中标签", () => {
    const facets = Array.from({ length: TAG_FILTER_LIMIT + 3 }, (_, index) => ({
      count: TAG_FILTER_LIMIT + 3 - index,
      tag: `tag-${index}`,
    }));
    const chips = buildTagChips(facets, ["已选标签"]);
    const tags = chips.map((chip) => chip.tag);
    expect(tags).toContain("tag-0");
    expect(tags).toContain(`tag-${TAG_FILTER_LIMIT - 1}`);
    expect(tags).not.toContain(`tag-${TAG_FILTER_LIMIT}`);
    expect(tags).toContain("已选标签");
  });

  it("选中但 facet 计数为 0 的标签仍保留且计数为 0", () => {
    const chips = buildTagChips([], ["消失的标签"]);
    expect(chips).toEqual([{ count: 0, tag: "消失的标签" }]);
  });

  it("同计数按 compareText 字典序排，且降序优先", () => {
    const facets: TagFacet[] = [
      { count: 2, tag: "Zebra" },
      { count: 5, tag: "apple" },
      { count: 2, tag: "Apple" },
    ];
    expect(buildTagChips(facets, []).map((chip) => chip.tag)).toEqual(["apple", "Apple", "Zebra"]);
  });

  it("大规模 facet 下输出与旧线性实现逐字一致（Map 命中不丢计数）", () => {
    const facets: TagFacet[] = Array.from({ length: 500 }, (_, index) => ({
      count: index % 17,
      tag: `tag-${index}`,
    }));
    const selected = ["tag-0", "tag-499", "not-in-facets"];
    expect(buildTagChips(facets, selected)).toEqual(buildTagChipsLegacy(facets, selected));
  });
});
