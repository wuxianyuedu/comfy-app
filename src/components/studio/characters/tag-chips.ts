/**
 * 角色库标签筛选行的派生计算（ISSUE #5203）。
 *
 * 展示集合只有「分面前 N + 已选中」这几枚，计数却要从 `tagFacets` 里取。此前对每枚
 * 标签 `tagFacets.find(...)` 线性扫描，标签种类一多就是 O(N×M)；这里改成按展示集合
 * 建一次索引（只扫一遍 facets、命中的才进 Map），之后每枚 O(1) 取数，只剩 O(n log n)
 * 排序。抽成纯函数便于直接对算法语义写回归用例（不依赖 React 渲染）。
 */
import { compareText } from "~/lib/ordered-set";

/** 标签筛选行最多展示几枚（按分面计数取前 N；已选中的恒在）。 */
export const TAG_FILTER_LIMIT = 24;

export type TagFacet = { count: number; tag: string };

export type TagChip = { count: number; tag: string };

/**
 * 收敛出筛选行要展示的标签及其计数。
 *
 * 展示集合 = 前 `TAG_FILTER_LIMIT` 个 facet + 已选中标签（选中即计数为 0 也要能取消）。
 * 索引只覆盖展示集合：全量建 Map 会为了最多几十枚展示标签去扫完全部 facets，
 * 在常见规模下反而比线性 find 更慢（见单 #5203 的取证读数）。
 */
export function buildTagChips(
  tagFacets: ReadonlyArray<TagFacet>,
  selectedTags: ReadonlyArray<string>,
): TagChip[] {
  const names = new Set<string>(selectedTags);
  for (const facet of tagFacets.slice(0, TAG_FILTER_LIMIT)) {
    names.add(facet.tag);
  }

  const counts = new Map<string, number>();
  for (const facet of tagFacets) {
    if (names.has(facet.tag)) {
      counts.set(facet.tag, facet.count);
    }
  }

  return [...names]
    .map((tag) => ({ count: counts.get(tag) ?? 0, tag }))
    .sort((left, right) => right.count - left.count || compareText(left.tag, right.tag));
}
