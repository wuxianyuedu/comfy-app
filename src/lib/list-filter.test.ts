/**
 * 「可搜索列表过滤」的判据（规范 16 §16.2.4.16）。
 *
 * 这条账的形状与 `display-value`（缺值占位符）同族：**不是重复代码，是口径**。
 * 全库 8 处各写一遍「搜索框 + 过滤」，而它们对「关键字怎么归一化」各判各的 ——
 * `AttributeMultiSelect` 只写了 `trim()`，其余写了 `trim().toLowerCase()`。
 * 两条都编译、都运行、类型都对，差别只在**一个语义决定**上：
 * **含拉丁字母的候选能不能被小写关键字搜到**。
 *
 * 所以用例重点不是「怎么切字符串」，而是这四件事各自站哪一边：
 *   1. 归一化**必须同时**去空白与折小写（`JK制服` 能被 `jk` 搜到）；
 *   2. 空关键字 = 不过滤（不是「什么都不匹配」）；
 *   3. 分组**保序**（不按命中数重排）；
 *   4. **空组丢弃**（含全空时返回空数组，调用处据此给「未找到匹配项」）。
 */
import { describe, expect, it } from "vitest";

import {
  filterGroups,
  filterGroupsByKeyword,
  matchesNeedle,
  normalizeNeedle,
} from "./list-filter";

describe("normalizeNeedle", () => {
  it("去两侧空白并折成小写", () => {
    expect(normalizeNeedle("  JK  ")).toBe("jk");
    expect(normalizeNeedle("T恤")).toBe("t恤");
  });

  it("「没输入」与「只输了空格」是同一件事（都当不过滤）", () => {
    expect(normalizeNeedle("")).toBe("");
    expect(normalizeNeedle("   ")).toBe("");
  });

  it("内部空白不折叠 —— 那是要搜的内容，不是排版", () => {
    expect(normalizeNeedle(" a b ")).toBe("a b");
  });
});

describe("matchesNeedle", () => {
  it("空关键字恒命中（不搜 = 全留）", () => {
    expect(matchesNeedle("", "任意")).toBe(true);
    expect(matchesNeedle("", "")).toBe(true);
  });

  it("子串命中，且两侧都折小写（调用处不必自己折）", () => {
    /* 这一条正是 AttributeMultiSelect 此前的缺陷：只 trim 不折小写时，
     * 用户输 `jk` 搜不到 `JK制服`。 */
    expect(matchesNeedle("jk", "JK制服")).toBe(true);
    expect(matchesNeedle("T恤", "t恤")).toBe(true);
    expect(matchesNeedle("3d", "3D建模")).toBe(true);
  });

  it("不命中就是 false（不做模糊 / 拼音 / 分词）", () => {
    expect(matchesNeedle("汉服", "旗袍")).toBe(false);
  });
});

interface Group {
  title: string;
  options: string[];
}

const GROUPS: Group[] = [
  { title: "中式", options: ["唐装", "汉服", "旗袍"] },
  { title: "日韩", options: ["和服", "JK制服"] },
  { title: "西式", options: ["风衣", "燕尾服"] },
];

describe("filterGroups", () => {
  it("空关键字原样返回（不重建数组）", () => {
    expect(filterGroups(GROUPS, "", "options")).toBe(GROUPS);
  });

  it("丢空组：搜「旗袍」只剩「中式」，且组内只留命中项", () => {
    const out = filterGroups(GROUPS, "旗袍", "options");
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("中式");
    expect(out[0]?.options).toEqual(["旗袍"]);
  });

  it("保组序：不按命中数重排（同一个关键字两次调用顺序一致）", () => {
    /* 「服」一次命中三组（中式 2 / 日韩 1+「JK制服」… / 西式 1）—— 命中数
     * 不同，顺序必须仍是数据里的中式 → 日韩 → 西式，不能按命中数把命中多的顶前。 */
    const out = filterGroups(GROUPS, "服", "options");
    expect(out.map((g) => g.title)).toEqual(["中式", "日韩", "西式"]);
    /* 再确认一遍：连续两次调用给出同一顺序（「界面在动」不是「结果在变」）。 */
    expect(filterGroups(GROUPS, "服", "options").map((g) => g.title)).toEqual(
      out.map((g) => g.title),
    );
  });

  it("全都不命中 → 空数组（调用处据此给「未找到匹配项」）", () => {
    expect(filterGroups(GROUPS, "不存在的东西", "options")).toEqual([]);
  });

  it("返回新对象：不改原分组，也不丢它自己的额外字段", () => {
    const withExtra = GROUPS.map((g, i) => ({ ...g, id: `g${i}` }));
    const out = filterGroups(withExtra, "旗袍", "options");
    expect(withExtra[1]?.options).toEqual(["和服", "JK制服"]);
    expect(out[0]?.id).toBe("g0");
    expect(out[0]).not.toBe(withExtra[0]);
  });

  it("默认命中判据对 `String(item)` 折小写子串匹配", () => {
    const nums = [{ title: "数", items: [1, 10, 21] }];
    /* 1 / 10 / 21 的十进制写法都含 "1"；只有 21 含 "2"。 */
    expect(filterGroups(nums, "1", "items")[0]?.items).toEqual([1, 10, 21]);
    expect(filterGroups(nums, "2", "items")[0]?.items).toEqual([21]);
  });

  it("命中判据可换成「看多个字段」——那是调用处的域判据", () => {
    const rows = [
      { title: "组", items: [{ name: "a", file: "x.safetensors" }] },
    ];
    const out = filterGroups(rows, "safeten", "items", (item) =>
      matchesNeedle("safeten", `${item.name} ${item.file}`),
    );
    expect(out).toHaveLength(1);
  });
});

describe("filterGroupsByKeyword", () => {
  it("一步到位：先归一化再分组过滤", () => {
    const out = filterGroupsByKeyword(GROUPS, "  jk  ", "options");
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("日韩");
    expect(out[0]?.options).toEqual(["JK制服"]);
  });

  it("空关键字原样返回", () => {
    expect(filterGroupsByKeyword(GROUPS, "   ", "options")).toBe(GROUPS);
  });
});
