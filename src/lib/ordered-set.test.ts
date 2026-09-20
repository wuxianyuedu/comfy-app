import { describe, expect, it } from "vitest";

import {
  compareText,
  union,
  unique,
  uniqueBy,
  uniqueSorted,
} from "./ordered-set";

describe("unique", () => {
  it("去重并保留首次出现的顺序", () => {
    expect(unique([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
  });

  it("空数组给空数组", () => {
    expect(unique([])).toEqual([]);
  });
});

describe("compareText", () => {
  it("按当前区域设置排序（不是按 UTF-16 码位）", () => {
    /* `localeCompare` 让 `"apple" < "Zebra"`；按码位则是 `"Zebra" < "apple"`
     * （大写 Z 的码位 90 < 小写 a 的 97）。这一条钉住的正是那条账：
     * 两种判据混用会让同一份列表在不同面板顺序相反。 */
    expect(compareText("apple", "Zebra")).toBeLessThan(0);
    expect("Zebra" < "apple").toBe(true);
  });
});

describe("uniqueSorted", () => {
  it("去重 + 字典序（大小写不敏感的观感）", () => {
    expect(uniqueSorted(["Zebra", "apple", "Zebra", "banana"])).toEqual([
      "apple",
      "banana",
      "Zebra",
    ]);
  });

  it("数字形态的字符串不按数值排（要数值序请显式传比较器）", () => {
    expect(uniqueSorted(["10", "9", "1"])).toEqual(["1", "10", "9"]);
    expect(
      uniqueSorted(["10", "9", "1"], (a, b) => Number(a) - Number(b)),
    ).toEqual(["1", "9", "10"]);
  });

  it("空数组给空数组", () => {
    expect(uniqueSorted([])).toEqual([]);
  });
});

describe("uniqueBy", () => {
  it("按字段去重、保留首次出现的整项", () => {
    const files = [
      { absPath: "/a/w.json", name: "w" },
      { absPath: "/b/w.json", name: "w" },
      { absPath: "/a/w.json", name: "w" },
    ];
    expect(uniqueBy(files, (f) => f.absPath)).toEqual([
      { absPath: "/a/w.json", name: "w" },
      { absPath: "/b/w.json", name: "w" },
    ]);
  });

  it("键为空值的项被跳过（没有身份的项不进结果集）", () => {
    const rows = [
      { name: "  " },
      { name: "alpha" },
      { name: "" },
      { name: "alpha" },
    ];
    expect(uniqueBy(rows, (r) => r.name.trim())).toEqual([{ name: "alpha" }]);
  });

  it("键为 0 / false 时**不**被跳过（它们是真实键）", () => {
    expect(uniqueBy([0, 0, 1], (v) => String(v))).toEqual([0, 1]);
    expect(uniqueBy([false, true, false], (v) => v)).toEqual([false, true]);
  });

  it("空数组给空数组", () => {
    expect(uniqueBy([], (v: string) => v)).toEqual([]);
  });
});

describe("union", () => {
  it("先到先得（前一路来源优先）", () => {
    expect(union(["a", "b"], ["c", "a"])).toEqual(["a", "b", "c"]);
  });

  it("三路以上同样成立", () => {
    expect(union(["a"], ["b", "a"], ["c"])).toEqual(["a", "b", "c"]);
  });

  it("空来源不产出项", () => {
    expect(union([], ["a"], [])).toEqual(["a"]);
    expect(union()).toEqual([]);
  });
});
